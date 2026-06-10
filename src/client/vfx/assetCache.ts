import { VFXAsset } from './assetLoader';
import type { VFXPackDef } from './packs';

type TransientEntry = {
  promise: Promise<VFXAsset>;
  asset: VFXAsset | null;
  refs: number;
};

export class VFXAssetCache {
  private readonly permanent = new Map<string, Promise<VFXAsset>>();
  private readonly transient = new Map<string, TransientEntry>();

  registerPermanent(def: VFXPackDef): Promise<VFXAsset> {
    const existing = this.permanent.get(def.id);
    if (existing) return existing;
    const promise = VFXAsset.load(def);
    this.permanent.set(def.id, promise);
    return promise;
  }

  getPermanent(id: string): Promise<VFXAsset> | undefined {
    return this.permanent.get(id);
  }

  // Refcounted on-demand load. Each acquire() must be paired with a release().
  acquire(def: VFXPackDef): Promise<VFXAsset> {
    let entry = this.transient.get(def.id);
    if (entry) {
      entry.refs += 1;
      return entry.promise;
    }
    const promise = VFXAsset.load(def);
    entry = { promise, asset: null, refs: 1 };
    this.transient.set(def.id, entry);
    void promise.then((asset) => {
      const current = this.transient.get(def.id);
      if (current === entry) current.asset = asset;
      else asset.dispose(); // released before load finished
    });
    return promise;
  }

  release(id: string): void {
    const entry = this.transient.get(id);
    if (!entry) return;
    entry.refs -= 1;
    if (entry.refs > 0) return;
    this.transient.delete(id);
    if (entry.asset) entry.asset.dispose();
    // If still loading, the .then() above will dispose once it resolves.
  }

  disposeAll(): void {
    for (const promise of this.permanent.values()) {
      void promise.then((asset) => asset.dispose());
    }
    this.permanent.clear();
    for (const entry of this.transient.values()) {
      if (entry.asset) entry.asset.dispose();
    }
    this.transient.clear();
  }
}
