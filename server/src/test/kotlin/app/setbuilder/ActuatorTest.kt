package app.setbuilder

import org.junit.jupiter.api.Test
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.boot.test.web.server.LocalManagementPort
import org.springframework.boot.test.web.server.LocalServerPort
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/** Actuator lives on its own localhost-only port, apart from the app and /api. */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = ["management.server.port=0"])
class ActuatorTest {
	@LocalServerPort var appPort = 0
	@LocalManagementPort var managementPort = 0

	private val http = HttpClient.newHttpClient()

	private fun get(port: Int, path: String): HttpResponse<String> =
		http.send(HttpRequest.newBuilder(URI("http://127.0.0.1:$port$path")).build(), HttpResponse.BodyHandlers.ofString())

	@Test
	fun `health is UP on the management port and checks the database`() {
		val response = get(managementPort, "/actuator/health")
		assertEquals(200, response.statusCode())
		assertTrue(response.body().contains("\"status\":\"UP\""), response.body())
		assertTrue(response.body().contains("\"db\""), response.body())
		assertEquals(200, get(managementPort, "/actuator/health/liveness").statusCode())
		assertEquals(200, get(managementPort, "/actuator/health/readiness").statusCode())
	}

	@Test
	fun `prometheus shows request metrics after app traffic`() {
		assertEquals(200, get(appPort, "/api/sets").statusCode())
		val response = get(managementPort, "/actuator/prometheus")
		assertEquals(200, response.statusCode())
		assertTrue(response.body().contains("http_server_requests_seconds_bucket"), "missing request histogram")
		assertTrue(response.body().contains("application=\"setbuilder\""), "missing application tag")
	}

	@Test
	fun `actuator and the app never share a port`() {
		assertEquals(404, get(appPort, "/actuator/health").statusCode())
		assertEquals(404, get(managementPort, "/api/sets").statusCode())
	}

	@Test
	fun `the old api health endpoint is gone`() {
		assertEquals(404, get(appPort, "/api/health").statusCode())
	}
}
