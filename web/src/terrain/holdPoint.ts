/** Remembers the last pick while the pointer is still, so a held 3D brush doesn't climb the material it just added. */
export class HoldPoint<T> {
  private key: string | null = null
  private point: T | null = null

  resolve(clientX: number, clientY: number, pick: () => T | null): T | null {
    const key = `${clientX},${clientY}`
    if (key !== this.key) {
      this.key = key
      this.point = pick()
    }
    return this.point
  }

  reset(): void {
    this.key = null
    this.point = null
  }
}
