package app.setbuilder.users

import jakarta.servlet.http.HttpServletRequest
import jakarta.servlet.http.HttpServletResponse
import io.micrometer.core.instrument.Counter
import io.micrometer.core.instrument.MeterRegistry
import org.springframework.beans.factory.ObjectProvider
import org.springframework.context.annotation.Configuration
import org.springframework.core.MethodParameter
import org.springframework.http.HttpHeaders
import org.springframework.http.ResponseCookie
import org.springframework.web.bind.support.WebDataBinderFactory
import org.springframework.web.context.request.NativeWebRequest
import org.springframework.web.method.support.HandlerMethodArgumentResolver
import org.springframework.web.method.support.ModelAndViewContainer
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer
import java.time.Duration
import java.time.Instant
import java.util.UUID

const val OWNER_COOKIE = "sb_owner"

/** The user making the request. Controllers take this as an argument and never read cookies themselves. */
data class CurrentUser(val id: UUID)

/**
 * Identifies the user by the owner cookie, creating an anonymous user when the cookie is missing, malformed or
 * unknown. An unknown id is never adopted, so a client can't choose its own id. Accounts will replace this.
 */
class CurrentUserResolver(
	private val userRepository: ObjectProvider<UserRepository>,
	private val meters: ObjectProvider<MeterRegistry>,
) : HandlerMethodArgumentResolver {
	private val usersCreated by lazy {
		meters.getIfAvailable()?.let { Counter.builder("setbuilder.users.created").description("Anonymous users created").register(it) }
	}

	override fun supportsParameter(parameter: MethodParameter) = parameter.parameterType == CurrentUser::class.java

	override fun resolveArgument(
		parameter: MethodParameter,
		mavContainer: ModelAndViewContainer?,
		webRequest: NativeWebRequest,
		binderFactory: WebDataBinderFactory?,
	): CurrentUser {
		val users = userRepository.getObject()
		val request = webRequest.getNativeRequest(HttpServletRequest::class.java)!!
		val existing = request.cookies?.firstOrNull { it.name == OWNER_COOKIE }?.value
			?.let { runCatching { UUID.fromString(it) }.getOrNull() }
			?.takeIf { users.existsById(it) }
		if (existing != null) return CurrentUser(existing)

		val user = users.save(UserEntity(UUID.randomUUID(), Instant.now()))
		usersCreated?.increment()
		val cookie = ResponseCookie.from(OWNER_COOKIE, user.id.toString())
			.httpOnly(true).sameSite("Lax").path("/api").maxAge(Duration.ofDays(365)).build()
		webRequest.getNativeResponse(HttpServletResponse::class.java)!!.addHeader(HttpHeaders.SET_COOKIE, cookie.toString())
		return CurrentUser(user.id)
	}
}

/** The repository and meter registry are looked up on first use so web-only test slices, which have no database, still load. */
@Configuration
class CurrentUserConfig(
	private val users: ObjectProvider<UserRepository>,
	private val meters: ObjectProvider<MeterRegistry>,
) : WebMvcConfigurer {
	override fun addArgumentResolvers(resolvers: MutableList<HandlerMethodArgumentResolver>) {
		resolvers.add(CurrentUserResolver(users, meters))
	}
}
