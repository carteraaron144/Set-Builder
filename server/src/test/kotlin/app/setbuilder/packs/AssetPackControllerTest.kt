package app.setbuilder.packs

import org.junit.jupiter.api.BeforeAll
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc
import org.springframework.test.context.DynamicPropertyRegistry
import org.springframework.test.context.DynamicPropertySource
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.get
import java.net.URI
import java.nio.file.Files
import java.nio.file.Path
import kotlin.io.path.createDirectories
import kotlin.io.path.writeBytes
import kotlin.io.path.writeText
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

@SpringBootTest
@AutoConfigureMockMvc
class AssetPackControllerTest(@Autowired val mockMvc: MockMvc) {

	companion object {
		@TempDir
		@JvmStatic
		lateinit var root: Path

		private val oak = byteArrayOf(0x67, 0x6c, 0x54, 0x46, 2, 0, 0, 0)

		@JvmStatic
		@DynamicPropertySource
		fun packsDir(registry: DynamicPropertyRegistry) {
			registry.add("setbuilder.packs-dir") { root.resolve("packs").toString() }
		}

		@JvmStatic
		@BeforeAll
		fun createPacks() {
			val packs = root.resolve("packs")
			pack(packs, "trees", """{"name": "Trees", "version": "1.0.0", "source": "Made in tests", "licence": "CC0-1.0", "assets": [{"id": "oak", "file": "models/oak.glb"}]}""")
			pack(packs, "rocks", """{"name": "Rocks", "version": "0.2.0", "source": "Kenney", "licence": "CC0-1.0"}""")
			pack(packs, "unlicensed", """{"name": "No licence", "version": "1.0.0", "source": "Somewhere"}""")
			pack(packs, "blank-licence", """{"name": "Blank", "version": "1.0.0", "source": "Somewhere", "licence": " "}""")
			packs.resolve("trees/models").createDirectories().resolve("oak.glb").writeBytes(oak)
			packs.resolve("no-manifest").createDirectories()
			pack(packs, "broken", """{"name": "Broken", """)
			root.resolve("secret.txt").writeText("top secret")
		}

		private fun pack(packs: Path, id: String, json: String) {
			packs.resolve(id).createDirectories().resolve("pack.json").writeText(json)
		}
	}

	@Test
	fun `lists valid packs sorted by id and skips bad ones`() {
		mockMvc.get("/api/asset-packs").andExpect {
			status { isOk() }
			jsonPath("$.length()") { value(2) }
			jsonPath("$[0].id") { value("rocks") }
			jsonPath("$[0].name") { value("Rocks") }
			jsonPath("$[0].version") { value("0.2.0") }
			jsonPath("$[0].source") { value("Kenney") }
			jsonPath("$[0].licence") { value("CC0-1.0") }
			jsonPath("$[1].id") { value("trees") }
			jsonPath("$[1].name") { value("Trees") }
			jsonPath("$[1].version") { value("1.0.0") }
			jsonPath("$[1].source") { value("Made in tests") }
		}
	}

	@Test
	fun `a missing packs directory lists nothing`() {
		val service = AssetPackService(AssetPackProperties(root.resolve("does-not-exist").toString()))
		assertEquals(emptyList(), service.list())
	}

	@Test
	fun `serves files from a pack`() {
		mockMvc.get("/packs/trees/models/oak.glb").andExpect {
			status { isOk() }
			content { bytes(oak) }
		}
	}

	@Test
	fun `a missing pack file is 404`() {
		mockMvc.get("/packs/trees/models/pine.glb").andExpect { status { isNotFound() } }
	}

	@Test
	fun `never serves files outside the packs directory`() {
		assertTrue(Files.exists(root.resolve("secret.txt")))
		for (path in listOf("/packs/trees/../secret.txt", "/packs/../secret.txt", "/packs/trees/%2e%2e/secret.txt", "/packs/%2e%2e/secret.txt")) {
			val result = mockMvc.get(URI.create(path)).andReturn().response
			assertTrue(result.status in 400..404, "$path returned ${result.status}")
			assertFalse(result.contentAsString.contains("top secret"), "$path leaked the file")
		}
	}
}
