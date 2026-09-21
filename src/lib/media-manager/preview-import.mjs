/** Only the latest selected file/conditions may become an actionable preview. */
export function createPreviewChannel() {
  let generation=0;
  return {
    invalidate(){generation++;},
    async run({capture,load,accept,reject}) {
      const request=++generation,isCurrent=()=>request===generation;
      try {
        // Capture file references and primitive metadata before the first await.
        const snapshot=capture();
        const result=await load(snapshot,isCurrent);
        if(!isCurrent())return false;
        accept(result,snapshot);
        return true;
      } catch(error) {
        if(isCurrent())reject(error);
        return false;
      }
    },
  };
}
