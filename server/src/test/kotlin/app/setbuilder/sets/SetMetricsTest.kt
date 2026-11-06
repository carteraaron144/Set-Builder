package app.setbuilder.sets

import app.setbuilder.users.OWNER_COOKIE
import io.micrometer.core.instrument.MeterRegistry
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
import kotlin.test.assertEquals

@SpringBootTest(properties = ["setbuilder.max-set-bytes=1000"])
@AutoConfigureMockMvc
class SetMetricsTest(
	@Autowired val mockMvc: MockMvc,
	@Autowired val jdbc: JdbcTemplate,
	@Autowired val meters: MeterRegistry,
) {
	private lateinit var me: Cookie

	@BeforeEach
	fun setUp() {
		jdbc.update("delete from sets")
		jdbc.update("delete from users")
		me = newUser()
	}

	private fun newUser() = Cookie(OWNER_COOKIE, mockMvc.get("/api/me").andReturn().response.getCookie(OWNER_COOKIE)!!.value)

	private fun counter(name: String, vararg tags: String) = meters.find(name).tags(*tags).counter()?.count() ?: 0.0
	private fun fileSizes() = meters.find("setbuilder.set.file.bytes").summary()!!

	/** Runs [block] and returns how much each named counter moved. */
	private fun deltas(vararg keys: Pair<String, Array<String>>, block: () -> Unit): List<Double> {
		val before = keys.map { (name, tags) -> counter(name, *tags) }
		block()
		return keys.mapIndexed { i, (name, tags) -> counter(name, *tags) - before[i] }
	}

	private val created = "setbuilder.sets.saved" to arrayOf("result", "created")
	private val replaced = "setbuilder.sets.saved" to arrayOf("result", "replaced")
	private fun rejected(reason: String) = "setbuilder.sets.rejected" to arrayOf("reason", reason)

	private fun put(id: UUID, owner: Cookie, name: String = "Canyon", bytes: ByteArray = byteArrayOf(1, 2, 3)) =
		mockMvc.multipart("/api/sets/$id") {
			with { it.method = "PUT"; it }
			cookie(owner)
			file(MockMultipartFile("meta", "", MediaType.APPLICATION_JSON_VALUE, """{"name":"$name","size":64}""".toByteArray()))
			file(MockMultipartFile("file", "set.setbuilder", MediaType.APPLICATION_OCTET_STREAM_VALUE, bytes))
		}

	@Test
	fun `saves count as created then replaced and record the file size`() {
		val id = UUID.randomUUID()
		val sizesBefore = fileSizes().count()
		val bytesBefore = fileSizes().totalAmount()
		assertEquals(listOf(1.0, 0.0), deltas(created, replaced) { put(id, me, bytes = ByteArray(300)) })
		assertEquals(listOf(0.0, 1.0), deltas(created, replaced) { put(id, me, bytes = ByteArray(200)) })
		assertEquals(2, fileSizes().count() - sizesBefore)
		assertEquals(500.0, fileSizes().totalAmount() - bytesBefore)
	}

	@Test
	fun `rejections count by reason and never as saved`() {
		val mine = UUID.randomUUID()
		put(mine, me)
		val other = newUser()
		val moved = deltas(created, replaced, rejected("invalid"), rejected("too-large"), rejected("not-found")) {
			put(UUID.randomUUID(), me, name = "")
			put(UUID.randomUUID(), me, bytes = ByteArray(1001))
			put(mine, other)
		}
		assertEquals(listOf(0.0, 0.0, 1.0, 1.0, 1.0), moved)
	}

	@Test
	fun `deletes count only when a set was removed`() {
		val id = UUID.randomUUID()
		put(id, me)
		val deleted = "setbuilder.sets.deleted" to emptyArray<String>()
		assertEquals(listOf(1.0), deltas(deleted) { mockMvc.delete("/api/sets/$id") { cookie(me) } })
		assertEquals(listOf(0.0), deltas(deleted) { mockMvc.delete("/api/sets/$id") { cookie(me) } })
	}

	@Test
	fun `new anonymous users are counted once`() {
		val users = "setbuilder.users.created" to emptyArray<String>()
		assertEquals(listOf(1.0), deltas(users) { newUser() })
		assertEquals(listOf(0.0), deltas(users) { mockMvc.get("/api/me") { cookie(me) } })
	}
}
