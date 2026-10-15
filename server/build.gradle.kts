plugins {
	kotlin("jvm") version "2.3.21"
	kotlin("plugin.spring") version "2.3.21"
	id("org.springframework.boot") version "4.1.1"
	id("io.spring.dependency-management") version "1.1.7"
}

group = "app"
version = "0.0.1-SNAPSHOT"

java {
	toolchain {
		languageVersion = JavaLanguageVersion.of(21)
	}
}

repositories {
	mavenCentral()
}

dependencies {
	implementation("org.springframework.boot:spring-boot-starter-webmvc")
	implementation("org.jetbrains.kotlin:kotlin-reflect")
	implementation("tools.jackson.module:jackson-module-kotlin")
	testImplementation("org.springframework.boot:spring-boot-starter-webmvc-test")
	testImplementation("org.jetbrains.kotlin:kotlin-test-junit5")
	testRuntimeOnly("org.junit.platform:junit-platform-launcher")
}

kotlin {
	compilerOptions {
		freeCompilerArgs.addAll("-Xjsr305=strict", "-Xannotation-default-target=param-property")
	}
}

tasks.withType<Test> {
	useJUnitPlatform()
}

// The web app (../web) is built with npm and bundled as static resources, served at "/".
// Pass -PskipWeb for fast server-only builds and tests.
val webDir = layout.projectDirectory.dir("../web")
val skipWeb = providers.gradleProperty("skipWeb").isPresent

val npmCi by tasks.registering(Exec::class) {
	description = "Installs the web app's npm dependencies."
	workingDir = webDir.asFile
	commandLine("npm", "ci")
	inputs.files(webDir.file("package.json"), webDir.file("package-lock.json"))
	outputs.file(webDir.file("node_modules/.package-lock.json"))
	onlyIf { !skipWeb }
}

val buildWeb by tasks.registering(Exec::class) {
	description = "Builds the web app into ../web/dist."
	dependsOn(npmCi)
	workingDir = webDir.asFile
	commandLine("npm", "run", "build")
	inputs.dir(webDir.dir("src"))
	inputs.dir(webDir.dir("public"))
	inputs.files(
		webDir.file("index.html"),
		webDir.file("package.json"),
		webDir.file("package-lock.json"),
		webDir.file("vite.config.ts"),
		webDir.file("tsconfig.json"),
		webDir.file("tsconfig.app.json"),
		webDir.file("tsconfig.node.json"),
	)
	outputs.dir(webDir.dir("dist"))
	onlyIf { !skipWeb }
}

tasks.processResources {
	if (!skipWeb) {
		dependsOn(buildWeb)
		from(webDir.dir("dist")) { into("static") }
	}
}
