package app.setbuilder.packs

import org.springframework.boot.context.properties.EnableConfigurationProperties
import org.springframework.context.annotation.Configuration
import org.springframework.web.servlet.config.annotation.ResourceHandlerRegistry
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer

/** Serves `/packs/<id>/<path>` from the packs directory. Spring's resource resolver rejects paths that escape it. */
@Configuration
@EnableConfigurationProperties(AssetPackProperties::class)
class PackResourceConfig(private val props: AssetPackProperties) : WebMvcConfigurer {

	override fun addResourceHandlers(registry: ResourceHandlerRegistry) {
		val location = props.packsRoot.toUri().toString().let { if (it.endsWith("/")) it else "$it/" }
		registry.addResourceHandler("/packs/**").addResourceLocations(location)
	}
}
