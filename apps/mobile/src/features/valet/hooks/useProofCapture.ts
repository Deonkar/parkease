import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { useCallback, useState } from 'react';

import { newIntent } from '@/lib/api';

import { uploadProof } from '../api/valet';
import { submitProof, type ProofDeps } from '../proof';

export interface ProofCaptureState {
  /** The captured image, kept across a failed upload. */
  readonly uri: string | null;
  readonly uploading: boolean;
  readonly error: string | null;
  readonly proofPhotoId: string | null;
  /** True once the server holds a photo for this job. */
  readonly attached: boolean;
  attach(uri: string): Promise<void>;
  retry(): Promise<void>;
  reset(): void;
}

/**
 * Compress-and-upload for the proof photo, with the image retained on failure.
 *
 * The compression runs before the request, not after a failure: a 4MB original
 * on a 3G connection in a basement car park is the difference between a proof
 * photo and a valet stuck on this screen.
 */
export function useProofCapture(jobId: string | null): ProofCaptureState {
  const [uri, setUri] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [proofPhotoId, setProofPhotoId] = useState<string | null>(null);

  const deps: ProofDeps = {
    compress: async (source, width, quality) => {
      // SDK 57's contextual API. `manipulateAsync` still exists but is
      // deprecated, and eslint's no-deprecated rule fails the build on it.
      const rendered = await ImageManipulator.manipulate(source).resize({ width }).renderAsync();
      const result = await rendered.saveAsync({
        compress: quality,
        format: SaveFormat.JPEG,
      });
      return { uri: result.uri, width: result.width, height: result.height };
    },
    upload: async (source) => {
      if (jobId === null) throw new Error('no active job to attach a photo to');
      return uploadProof(
        source,
        jobId,
        // One key per user intent: a retry of THIS photo replays the same
        // upload rather than creating a second one (R-FE-05).
        newIntent(),
      );
    },
  };

  // Rebuilt per render, which is fine: it closes over `jobId` and is consumed
  // synchronously inside `run`. Extracted to a ref-free local so the callback
  // below has an honest dependency list.
  const run = useCallback(
    async (source: string) => {
      setUri(source);
      setUploading(true);
      setError(null);

      const result = await submitProof(source, deps);
      setUploading(false);

      if (result.ok) {
        setProofPhotoId(result.proofPhotoId);
        setError(null);
        return;
      }
      // The image stays on screen; only the error changes.
      setError(result.message);
    },
    [jobId],
  );

  const attach = useCallback(async (source: string) => run(source), [run]);

  const retry = useCallback(async () => {
    if (uri === null) return;
    await run(uri);
  }, [run, uri]);

  const reset = useCallback(() => {
    setUri(null);
    setUploading(false);
    setError(null);
    setProofPhotoId(null);
  }, []);

  return {
    uri,
    uploading,
    error,
    proofPhotoId,
    attached: proofPhotoId !== null,
    attach,
    retry,
    reset,
  };
}
