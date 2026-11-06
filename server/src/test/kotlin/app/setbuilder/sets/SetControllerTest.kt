package app.setbuilder.sets

import app.setbuilder.users.OWNER_COOKIE
import jakarta.servlet.http.Cookie
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc
import org.springframework.http.MediaType
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.mock.web.MockMultipartFile
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.delete
import org.springframework.test.web.servlet.get
import org.springframework.test.web.servlet.multipart
import java.util.UUID
import kotlin.test.assertContentEquals

@SpringBootTest(properties = ["setbuilder.max-set-bytes=1000"])
@AutoConfigureMockMvc
class SetControllerTest(
	@Autowired val mockMvc: MockMvc,
	@Autowired val jdbc: JdbcTemplate,
) {
	private lateinit var me: Cookie
	private lateinit var other: Cookie

	@BeforeEach
	fun setUp() {
		jdbc.update("delete from sets")
		jdbc.update("delete from users")
		me = newUser()
		other = newUser()
	}

	private fun newUser(): Cookie {
		val value = mockMvc.get("/api/me").andReturn().response.getCookie(OWNER_COOKIE)!!.value
		return Cookie(OWNER_COOKIE, value)
	}

	private fun put(
		id: UUID,
		owner: Cookie,
		name: String = "Canyon",
		size: Int = 128,
		bytes: ByteArray = byteArrayOf(1, 2, 3),
	) = mockMvc.multipart("/api/sets/$id") {
		with { it.method = "PUT"; it }
		cookie(owner)
		file(MockMultipartFile("meta", "", MediaType.APPLICATION_JSON_VALUE, """{"name":${'"'}$name${'"'},"size":$size}""".toByteArray()))
		file(MockMultipartFile("file", "set.setbuilder", MediaType.APPLICATION_OCTET_STREAM_VALUE, bytes))
	}

	@Test
	fun `put then get round-trips the file bytes`() {
		val id = UUID.randomUUID()
		val bytes = ByteArray(500) { it.toByte() }
		put(id, me, bytes = bytes).andExpect {
			status { isOk() }
			jsonPath("$.id") { value(id.toString()) }
			jsonPath("$.name") { value("Canyon") }
			jsonPath("$.size") { value(128) }
			jsonPath("$.updatedAt") { isString() }
		}
		val body = mockMvc.get("/api/sets/$id") { cookie(me) }
			.andExpect { status { isOk() }; content { contentType(MediaType.APPLICATION_OCTET_STREAM) } }
			.andReturn().response.contentAsByteArray
		assertContentEquals(bytes, body)
	}

	@Test
	fun `put replaces an existing set`() {
		val id = UUID.randomUUID()
		put(id, me, name = "Old")
		put(id, me, name = "New", bytes = byteArrayOf(9)).andExpect { status { isOk() } }
		mockMvc.get("/api/sets") { cookie(me) }.andExpect {
			jsonPath("$.length()") { value(1) }
			jsonPath("$[0].name") { value("New") }
		}
		val body = mockMvc.get("/api/sets/$id") { cookie(me) }.andReturn().response.contentAsByteArray
		assertContentEquals(byteArrayOf(9), body)
	}

	@Test
	fun `list is newest first, owner-scoped and has no file bytes`() {
		val first = UUID.randomUUID()
		val second = UUID.randomUUID()
		put(first, me, name = "First")
		put(second, me, name = "Second")
		put(UUID.randomUUID(), other, name = "Theirs")
		mockMvc.get("/api/sets") { cookie(me) }.andExpect {
			status { isOk() }
			jsonPath("$.length()") { value(2) }
			jsonPath("$[0].id") { value(second.toString()) }
			jsonPath("$[1].id") { value(first.toString()) }
			jsonPath("$[0].file") { doesNotExist() }
		}
	}

	@Test
	fun `delete removes the set`() {
		val id = UUID.randomUUID()
		put(id, me)
		mockMvc.delete("/api/sets/$id") { cookie(me) }.andExpect { status { isNoContent() } }
		mockMvc.get("/api/sets/$id") { cookie(me) }.andExpect { status { isNotFound() } }
	}

	@Test
	fun `another owner gets 404 everywhere and cannot overwrite`() {
		val id = UUID.randomUUID()
		put(id, me, name = "Mine", bytes = byteArrayOf(7))
		mockMvc.get("/api/sets/$id") { cookie(other) }.andExpect { status { isNotFound() } }
		mockMvc.delete("/api/sets/$id") { cookie(other) }.andExpect { status { isNotFound() } }
		put(id, other, name = "Hijacked", bytes = byteArrayOf(0)).andExpect { status { isNotFound() } }
		mockMvc.get("/api/sets") { cookie(me) }.andExpect { jsonPath("$[0].name") { value("Mine") } }
		val body = mockMvc.get("/api/sets/$id") { cookie(me) }.andReturn().response.contentAsByteArray
		assertContentEquals(byteArrayOf(7), body)
	}

	@Test
	fun `missing set is 404`() {
		mockMvc.get("/api/sets/${UUID.randomUUID()}") { cookie(me) }.andExpect { status { isNotFound() } }
		mockMvc.delete("/api/sets/${UUID.randomUUID()}") { cookie(me) }.andExpect { status { isNotFound() } }
	}

	@Test
	fun `bad input is 400`() {
		put(UUID.randomUUID(), me, name = "").andExpect {
			status { isBadRequest() }
			jsonPath("$.detail") { value("Name must be 1 to 200 characters") }
		}
		put(UUID.randomUUID(), me, name = "x".repeat(201)).andExpect { status { isBadRequest() } }
		put(UUID.randomUUID(), me, size = 100).andExpect { status { isBadRequest() } }
		put(UUID.randomUUID(), me, bytes = ByteArray(0)).andExpect { status { isBadRequest() } }
		mockMvc.get("/api/sets/not-a-uuid") { cookie(me) }.andExpect { status { isBadRequest() } }
		mockMvc.get("/api/sets") { cookie(me) }.andExpect { jsonPath("$.length()") { value(0) } }
	}

	@Test
	fun `oversize file is 413`() {
		put(UUID.randomUUID(), me, bytes = ByteArray(1001)).andExpect { status { isPayloadTooLarge() } }
		put(UUID.randomUUID(), me, bytes = ByteArray(1000)).andExpect { status { isOk() } }
	}
}
