/**
 * Provider abstraction for packshot processing. Any backend that takes an image
 * in and returns a processed image out implements this interface.
 */
export interface PackshotProvider {
  readonly name: string;
  process(
    input: { buffer: Buffer; mimeType: string },
    opts: { workflowId?: string }
  ): Promise<{ buffer: Buffer; mimeType: string }>;
}
