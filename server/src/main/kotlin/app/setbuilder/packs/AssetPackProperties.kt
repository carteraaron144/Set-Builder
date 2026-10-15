package app.setbuilder.packs

import org.springframework.boot.context.properties.ConfigurationProperties
import java.nio.file.Path

/**
 * Asset packs live in `packsDir/<id>/` with a `pack.json` manifest. Relative paths resolve from the working directory.
 * Bound as a String: Spring converts a Path through the servlet context, which rejects `../packs`.
 */
@ConfigurationProperties("setbuilder")
data class AssetPackProperties(val packsDir: String = "../packs") {
	val packsRoot: Path get() = Path.of(packsDir).toAbsolutePath().normalize()
}
