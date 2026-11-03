package app.setbuilder.users

import jakarta.servlet.http.Cookie
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.get
import java.util.UUID
import kotlin.test.assertEquals
import kotlin.test.assertNotEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

@SpringBootTest
@AutoConfigureMockMvc
class CurrentUserTest(
	@Autowired val mockMvc: MockMvc,
	@Autowired val users: UserRepository,
	@Autowired val jdbc: JdbcTemplate,
) {
	@BeforeEach
	fun clean() {
		jdbc.update("delete from sets")
		jdbc.update("delete from users")
	}

	private fun me(cookie: Cookie? = null) = mockMvc.get("/api/me") { cookie?.let { cookie(it) } }
		.andExpect { status { isOk() } }.andReturn().response

	@Test
	fun `no cookie creates a user and sets the cookie`() {
		val response = me()
		val header = response.getHeader("Set-Cookie")
		assertNotNull(header)
		assertTrue(header.startsWith("$OWNER_COOKIE="))
		assertTrue(header.contains("HttpOnly"))
		assertTrue(header.contains("SameSite=Lax"))
		assertTrue(header.contains("Path=/api"))
		val id = UUID.fromString(response.getCookie(OWNER_COOKIE)!!.value)
		assertTrue(users.existsById(id))
		assertTrue(response.contentAsString.contains(id.toString()))
	}

	@Test
	fun `a valid cookie reuses the user without setting a new cookie`() {
		val id = UUID.fromString(me().getCookie(OWNER_COOKIE)!!.value)
		val response = me(Cookie(OWNER_COOKIE, id.toString()))
		assertNull(response.getHeader("Set-Cookie"))
		assertTrue(response.contentAsString.contains(id.toString()))
		assertEquals(1, users.count())
	}

	@Test
	fun `a malformed cookie creates a new user`() {
		val response = me(Cookie(OWNER_COOKIE, "not-a-uuid"))
		assertNotNull(response.getCookie(OWNER_COOKIE))
		assertEquals(1, users.count())
	}

	@Test
	fun `an unknown cookie gets a fresh id rather than adopting the client's`() {
		val forged = UUID.randomUUID()
		val response = me(Cookie(OWNER_COOKIE, forged.toString()))
		val id = UUID.fromString(response.getCookie(OWNER_COOKIE)!!.value)
		assertNotEquals(forged, id)
		assertTrue(users.existsById(id))
		assertTrue(!users.existsById(forged))
	}
}
