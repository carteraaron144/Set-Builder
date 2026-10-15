package app.setbuilder.packs

import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.RestController

@RestController
class AssetPackController(private val service: AssetPackService) {

	@GetMapping("/api/asset-packs")
	fun list(): List<AssetPack> = service.list()
}
