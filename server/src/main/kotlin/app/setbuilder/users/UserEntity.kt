package app.setbuilder.users

import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.Id
import jakarta.persistence.Table
import org.springframework.data.jpa.repository.JpaRepository
import java.time.Instant
import java.util.UUID

/** Anonymous for now; accounts will add login fields here. */
@Entity
@Table(name = "users")
class UserEntity(
	@Id val id: UUID,
	@Column(name = "created_at", nullable = false) val createdAt: Instant,
)

interface UserRepository : JpaRepository<UserEntity, UUID>
