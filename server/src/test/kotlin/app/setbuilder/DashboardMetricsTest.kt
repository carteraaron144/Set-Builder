package app.setbuilder

import org.junit.jupiter.api.Test
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.boot.test.web.server.LocalManagementPort
import org.springframework.boot.test.web.server.LocalServerPort
import tools.jackson.databind.JsonNode
import tools.jackson.databind.json.JsonMapper
import java.io.File
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import kotlin.test.assertTrue

/** Every metric the Grafana dashboard queries must exist in the server's Prometheus output, so renames can't silently empty a panel. */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = ["management.server.port=0"])
class DashboardMetricsTest {
	@LocalServerPort var appPort = 0
	@LocalManagementPort var managementPort = 0

	private val dashboard = File("../ops/grafana/dashboards/set-builder.json")

	/** Prometheus' own `up` series comes from the scrape, not the app. */
	private val fromPrometheus = setOf("up")

	private fun get(port: Int, path: String): String = HttpClient.newHttpClient()
		.send(HttpRequest.newBuilder(URI("http://127.0.0.1:$port$path")).build(), HttpResponse.BodyHandlers.ofString()).body()

	private fun expressions(node: JsonNode): List<String> = buildList {
		node.get("expr")?.let { add(it.asString()) }
		node.forEach { addAll(expressions(it)) }
	}

	@Test
	fun `every metric in the dashboard is exported`() {
		val exprs = expressions(JsonMapper.builder().build().readTree(dashboard))
		val metrics = exprs.flatMap { Regex("""([a-zA-Z_:][a-zA-Z0-9_:]*)\{""").findAll(it).map { m -> m.groupValues[1] } }.toSet() - fromPrometheus
		assertTrue(metrics.size >= 15, "expected the dashboard's metrics, found $metrics")

		get(appPort, "/api/sets")
		val exported = get(managementPort, "/actuator/prometheus").lineSequence()
			.filter { it.isNotBlank() && !it.startsWith("#") }
			.map { it.substringBefore('{').substringBefore(' ') }
			.toSet()
		val missing = metrics - exported
		assertTrue(missing.isEmpty(), "dashboard queries metrics the server doesn't export: $missing")
	}
}
