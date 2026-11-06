package app.setbuilder.sets

import org.springframework.beans.factory.annotation.Value
import org.springframework.http.HttpStatus
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import org.springframework.web.server.ResponseStatusException
import java.time.Instant
import java.util.UUID

val SET_SIZES = setOf(64, 128, 256)
const val MAX_NAME_LENGTH = 200

data class SetMeta(val name: String, val size: Int)

data class SetSummaryDto(val id: UUID, val name: String, val size: Int, val updatedAt: Instant)

private fun SetSummary.toDto() = SetSummaryDto(id, name, size, updatedAt)
private fun SetEntity.toDto() = SetSummaryDto(id, name, size, updatedAt)

@Service
class SetService(
	private val sets: SetRepository,
	private val metrics: SetMetrics,
	@Value("\${setbuilder.max-set-bytes:67108864}") private val maxSetBytes: Long,
) {
	@Transactional(readOnly = true)
	fun list(ownerId: UUID): List<SetSummaryDto> = sets.findByOwnerIdOrderByUpdatedAtDesc(ownerId).map { it.toDto() }

	@Transactional(readOnly = true)
	fun file(id: UUID, ownerId: UUID): ByteArray = (sets.findByIdAndOwnerId(id, ownerId) ?: throw notFound()).file

	/** Creates or replaces the set. A set owned by someone else looks missing and is never overwritten. */
	@Transactional
	fun save(id: UUID, ownerId: UUID, meta: SetMeta, file: ByteArray): SetSummaryDto {
		val name = meta.name.trim()
		if (name.isEmpty() || name.length > MAX_NAME_LENGTH) throw invalid("Name must be 1 to $MAX_NAME_LENGTH characters")
		if (meta.size !in SET_SIZES) throw invalid("Size must be one of $SET_SIZES")
		if (file.isEmpty()) throw invalid("The set file is empty")
		if (file.size > maxSetBytes) {
			metrics.rejected(SetMetrics.Rejection.TOO_LARGE)
			throw ResponseStatusException(HttpStatus.CONTENT_TOO_LARGE, "The set file is too large")
		}

		val existing = sets.findById(id).orElse(null)
		if (existing != null && existing.ownerId != ownerId) {
			metrics.rejected(SetMetrics.Rejection.NOT_FOUND)
			throw notFound()
		}
		val now = Instant.now()
		val saved = when (existing) {
			null -> sets.save(SetEntity(id, ownerId, name, meta.size, now, file))
			else -> existing.apply {
				this.name = name
				this.size = meta.size
				this.updatedAt = now
				this.file = file
			}
		}
		metrics.saved(created = existing == null, bytes = file.size)
		return saved.toDto()
	}

	@Transactional
	fun delete(id: UUID, ownerId: UUID) {
		if (sets.deleteByIdAndOwnerId(id, ownerId) == 0L) throw notFound()
		metrics.deleted()
	}

	private fun notFound() = ResponseStatusException(HttpStatus.NOT_FOUND, "Set not found")
	private fun invalid(reason: String): ResponseStatusException {
		metrics.rejected(SetMetrics.Rejection.INVALID)
		return ResponseStatusException(HttpStatus.BAD_REQUEST, reason)
	}
}
