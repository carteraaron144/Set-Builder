package app.setbuilder.sets

import app.setbuilder.users.CurrentUser
import org.springframework.http.HttpStatus
import org.springframework.http.MediaType
import org.springframework.web.bind.annotation.DeleteMapping
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PutMapping
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RequestPart
import org.springframework.web.bind.annotation.ResponseStatus
import org.springframework.web.bind.annotation.RestController
import org.springframework.web.multipart.MultipartFile
import java.util.UUID

@RestController
@RequestMapping("/api/sets")
class SetController(private val sets: SetService) {
	@GetMapping
	fun list(user: CurrentUser) = sets.list(user.id)

	@GetMapping("/{id}", produces = [MediaType.APPLICATION_OCTET_STREAM_VALUE])
	fun get(@PathVariable id: UUID, user: CurrentUser): ByteArray = sets.file(id, user.id)

	/** Multipart: `meta` is JSON `{name, size}`, `file` is the .setbuilder zip. */
	@PutMapping("/{id}", consumes = [MediaType.MULTIPART_FORM_DATA_VALUE])
	fun put(
		@PathVariable id: UUID,
		@RequestPart("meta") meta: SetMeta,
		@RequestPart("file") file: MultipartFile,
		user: CurrentUser,
	) = sets.save(id, user.id, meta, file.bytes)

	@DeleteMapping("/{id}")
	@ResponseStatus(HttpStatus.NO_CONTENT)
	fun delete(@PathVariable id: UUID, user: CurrentUser) = sets.delete(id, user.id)
}
