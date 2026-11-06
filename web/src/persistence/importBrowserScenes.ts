import { openSceneStore, type SceneStore } from './sceneStore'

/**
 * Moves scenes saved in this browser (before the server held them) up to the server, oldest first so the server's
 * newest-first order matches. Each scene leaves browser storage as soon as its upload succeeds, so a retry after a
 * failure never re-uploads, and never overwrites, a scene that is already on the server. Never throws.
 */
export async function importBrowserScenes(
  remote: SceneStore,
  openLocal: () => Promise<SceneStore> = () => openSceneStore(),
): Promise<{ imported: number; remaining: number }> {
  let local: SceneStore
  let summaries
  try {
    local = await openLocal()
    summaries = await local.list()
  } catch {
    return { imported: 0, remaining: 0 }
  }
  let imported = 0
  for (const { id } of summaries.reverse()) {
    try {
      const contents = await local.load(id)
      if (!contents) continue
      await remote.save(contents.scene, contents.layers)
      await local.remove(id)
      imported++
    } catch {
      // Damaged locally or the upload failed: keep it in the browser and try again next start.
    }
  }
  return { imported, remaining: summaries.length - imported }
}
