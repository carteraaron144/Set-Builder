package app.setbuilder.sets

import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.Id
import jakarta.persistence.Table
import org.springframework.data.jpa.repository.JpaRepository
import java.time.Instant
import java.util.UUID

@Entity
@Table(name = "sets")
class SetEntity(
	@Id val id: UUID,
	@Column(name = "owner_id", nullable = false) val ownerId: UUID,
	var name: String,
	var size: Int,
	@Column(name = "updated_at", nullable = false) var updatedAt: Instant,
	/** The .setbuilder zip exactly as the web app wrote it; the server never parses it. */
	@Column(nullable = false) var file: ByteArray,
)

/** What a set list shows. An interface projection, so listing never loads the file bytes. */
interface SetSummary {
	val id: UUID
	val name: String
	val size: Int
	val updatedAt: Instant
}

interface SetRepository : JpaRepository<SetEntity, UUID> {
	fun findByOwnerIdOrderByUpdatedAtDesc(ownerId: UUID): List<SetSummary>
	fun findByIdAndOwnerId(id: UUID, ownerId: UUID): SetEntity?
	fun deleteByIdAndOwnerId(id: UUID, ownerId: UUID): Long
}
