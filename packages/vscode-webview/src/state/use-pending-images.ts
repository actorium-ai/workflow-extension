import { useCallback, useState } from 'react';

import { getVsCodeApi } from '../utils/vscode-api.ts';

const vscode = getVsCodeApi();

export interface PendingImage {
  localId: string;
  previewUrl: string;
  /** Same bytes as previewUrl but as a `data:` URL, which (unlike a `blob:`
   * object URL) survives being persisted via vscode.setState and rehydrated
   * after a webview reload — this is what sent turns' imageUrls should use,
   * not previewUrl. Set once the file's been read (well before 'done'/
   * upload finishes), so it's always populated by the time a message can
   * actually be sent. */
  dataUrl?: string;
  status: 'uploading' | 'done' | 'error';
  imageId?: string;
}

/** Reads a File/Blob into a `data:` URL — the only way to hand pasted image
 * bytes to the extension host, since postMessage payloads must be
 * JSON-serializable and the host (Node, not a browser) has no
 * createObjectURL/Blob-from-clipboard path of its own. Also doubles as the
 * persisted display source for sent turns (see PendingImage.dataUrl) since,
 * unlike a blob: object URL, it survives a webview reload. */
function fileToDataUrl(file: File | Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/**
 * Owns pasted/attached images pending send — mirrors digital-factory-ui's
 * own pendingImages state (agent-chat-panel.tsx). Upload happens via a
 * postMessage round-trip to the extension host (ChatPanelProvider's
 * 'pasteImage' case → coding-api.ts's uploadImage), since only the host has
 * a bearer token and can hit storage-service directly.
 */
export function usePendingImages() {
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);

  const addImage = useCallback((file: File | Blob) => {
    const localId = `img-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const previewUrl = URL.createObjectURL(file);
    setPendingImages((prev) => [...prev, { localId, previewUrl, status: 'uploading' }]);
    void fileToDataUrl(file).then((dataUrl) => {
      setPendingImages((prev) => prev.map((p) => (p.localId === localId ? { ...p, dataUrl } : p)));
      const comma = dataUrl.indexOf(',');
      const dataBase64 = comma === -1 ? dataUrl : dataUrl.slice(comma + 1);
      vscode.postMessage({
        command: 'pasteImage',
        localId,
        dataBase64,
        mimeType: file.type || 'image/png',
      });
    });
  }, []);

  const removeImage = useCallback((localId: string) => {
    setPendingImages((prev) => {
      const target = prev.find((p) => p.localId === localId);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((p) => p.localId !== localId);
    });
  }, []);

  /** Applies an 'imageUploaded' extension message. */
  const markUploaded = useCallback((localId: string, imageId: string) => {
    setPendingImages((prev) =>
      prev.map((p) => (p.localId === localId ? { ...p, status: 'done', imageId } : p)),
    );
  }, []);

  /** Applies an 'imageUploadFailed' extension message. */
  const markFailed = useCallback((localId: string) => {
    setPendingImages((prev) =>
      prev.map((p) => (p.localId === localId ? { ...p, status: 'error' } : p)),
    );
  }, []);

  /** Clears the pending-attachment strip after a successful send — mirrors
   * digital-factory-ui's setPendingImages([]). Safe to revoke every
   * previewUrl here: the just-sent user turn's imageUrls (see
   * use-chat-controller.ts's sendMessage) uses each image's dataUrl as its
   * display source, not previewUrl, so the sent bubble doesn't depend on
   * these blob URLs staying alive. */
  const clear = useCallback(() => {
    setPendingImages((prev) => {
      prev.forEach((p) => URL.revokeObjectURL(p.previewUrl));
      return [];
    });
  }, []);

  const doneImageIds = pendingImages
    .filter((p): p is PendingImage & { imageId: string } => p.status === 'done' && !!p.imageId)
    .map((p) => p.imageId);
  const hasUploading = pendingImages.some((p) => p.status === 'uploading');

  return {
    pendingImages,
    addImage,
    removeImage,
    markUploaded,
    markFailed,
    clear,
    doneImageIds,
    hasUploading,
  };
}
