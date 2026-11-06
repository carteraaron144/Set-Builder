package app.setbuilder.users

import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.RestController

@RestController
class MeController {
	@GetMapping("/api/me")
	fun me(user: CurrentUser) = mapOf("id" to user.id)
}
