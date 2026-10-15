package app.setbuilder.packs

import com.fasterxml.jackson.annotation.JsonIgnoreProperties
import org.slf4j.LoggerFactory
import org.springframework.stereotype.Service
import tools.jackson.module.kotlin.jacksonObjectMapper
import tools.jackson.module.kotlin.readValue
import java.nio.file.Files
import java.nio.file.Path
import kotlin.io.path.isDirectory
import kotlin.io.path.isRegularFile
import kotlin.io.path.listDirectoryEntries
import kotlin.io.path.name

data class AssetPack(val id: String, val name: String, val version: String, val source: String, val licence: String)

/** pack.json; fields the server doesn't need (such as `assets`) are ignored. Every pack must record its source and licence. */
@JsonIgnoreProperties(ignoreUnknown = true)
private data class PackManifest(val name: String, val version: String, val source: String? = null, val licence: String? = null)

@Service
class AssetPackService(private val props: AssetPackProperties) {

	private val log = LoggerFactory.getLogger(javaClass)
	private val mapper = jacksonObjectMapper()

	/** Valid packs sorted by id; directories without a readable pack.json are logged and skipped. */
	fun list(): List<AssetPack> {
		val root = props.packsRoot
		if (!root.isDirectory()) return emptyList()
		return root.listDirectoryEntries()
			.filter { it.isDirectory() && !it.name.startsWith(".") }
			.mapNotNull { read(it) }
			.sortedBy { it.id }
	}

	private fun read(dir: Path): AssetPack? {
		val manifest = dir.resolve("pack.json")
		if (!manifest.isRegularFile()) {
			log.warn("Skipping asset pack {}: no pack.json", dir.name)
			return null
		}
		return try {
			val m = Files.newInputStream(manifest).use { mapper.readValue<PackManifest>(it) }
			if (m.source.isNullOrBlank() || m.licence.isNullOrBlank()) {
				log.warn("Skipping asset pack {}: pack.json needs a source and a licence", dir.name)
				return null
			}
			AssetPack(id = dir.name, name = m.name, version = m.version, source = m.source, licence = m.licence)
		} catch (e: Exception) {
			log.warn("Skipping asset pack {}: unreadable pack.json ({})", dir.name, e.message)
			null
		}
	}
}
