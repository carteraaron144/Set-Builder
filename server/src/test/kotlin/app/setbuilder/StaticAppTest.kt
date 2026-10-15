package app.setbuilder

import org.junit.jupiter.api.Test
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.boot.test.web.server.LocalServerPort
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import kotlin.test.assertEquals
import kotlin.test.assertTrue

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class StaticAppTest(@LocalServerPort val port: Int) {

	@Test
	fun `serves the web app at the root`() {
		val response = HttpClient.newHttpClient().send(
			HttpRequest.newBuilder(URI.create("http://localhost:$port/")).build(),
			HttpResponse.BodyHandlers.ofString(),
		)
		assertEquals(200, response.statusCode())
		assertTrue(response.body().contains("<div id=\"root\"></div>"), response.body())
		assertTrue(response.headers().firstValue("Content-Type").orElse("").startsWith("text/html"))
	}
}
