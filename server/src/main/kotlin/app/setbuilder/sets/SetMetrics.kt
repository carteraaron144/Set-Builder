package app.setbuilder.sets

import io.micrometer.core.instrument.Counter
import io.micrometer.core.instrument.DistributionSummary
import io.micrometer.core.instrument.MeterRegistry
import org.springframework.stereotype.Component

/**
 * Set Builder's own metrics. Every meter and tag value is registered up front so each series exists (at zero) before
 * its first event, which keeps Grafana panels and rate() queries from showing gaps. Tags stay low-cardinality:
 * never a user or set id.
 */
@Component
class SetMetrics(registry: MeterRegistry) {
	enum class Rejection(val tag: String) { INVALID("invalid"), TOO_LARGE("too-large"), NOT_FOUND("not-found") }

	private val created = savedCounter(registry, "created")
	private val replaced = savedCounter(registry, "replaced")
	private val rejected = Rejection.entries.associateWith {
		Counter.builder("setbuilder.sets.rejected").description("Set saves the server refused").tag("reason", it.tag).register(registry)
	}
	private val deleted = Counter.builder("setbuilder.sets.deleted").description("Sets deleted").register(registry)
	private val fileBytes = DistributionSummary.builder("setbuilder.set.file.bytes")
		.description("Size of each saved .setbuilder file").baseUnit("bytes").publishPercentileHistogram().register(registry)

	fun saved(created: Boolean, bytes: Int) {
		(if (created) this.created else replaced).increment()
		fileBytes.record(bytes.toDouble())
	}

	fun rejected(reason: Rejection) = rejected.getValue(reason).increment()

	fun deleted() = deleted.increment()

	private fun savedCounter(registry: MeterRegistry, result: String) =
		Counter.builder("setbuilder.sets.saved").description("Set saves that succeeded").tag("result", result).register(registry)
}
