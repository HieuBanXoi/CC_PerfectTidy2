import { _decorator, Node, ParticleSystem2D, Sprite, SpriteFrame, Texture2D, UITransform, Vec3, Enum } from 'cc';
import { Item } from '../Items/Components/Item';
import { ItemDraggable } from '../Items/Components/ItemDraggable';
import { ItemCleanManager } from '../Systems/ItemCleanManager';
import { Ply_SoundManager, FxType } from '../Framework/Ply_SoundManager';
import { Ply_Event } from '../Framework/Ply_Event';
import { World } from '../../Core/Managers/World';
import { PoolType } from '../../Core/Pooling/PoolMember';
import { readImagePixels } from '../Matching/ReadImagePixel';
import type { FoamEffect } from '../Effects/FoamEffect';

const { ccclass, property } = _decorator;

/** Một vùng nhận bọt (ví dụ FoamMask của 1 sandbox). */
@ccclass('SprayFoamTarget')
export class SprayFoamTarget {
    @property({ type: Node, tooltip: 'Node cha của bọt (FoamMask). Bọt spawn ra sẽ là con của node này.' })
    public foamParent: Node | null = null;

    @property({ type: Node, tooltip: 'Vùng nhận xịt (UITransform). Để trống sẽ dùng foamParent.' })
    public area: Node | null = null;

    @property({ min: 0.05, max: 1, step: 0.05, slide: true, tooltip: 'Tỉ lệ diện tích vùng cần được bọt phủ để tính là xong (0.8 = 80%).' })
    public requiredCoverage = 0.8;

    @property({ min: 1, step: 1, tooltip: 'Giới hạn số bọt tối đa của vùng này (an toàn hiệu năng).' })
    public maxFoamCount = 40;

    @property({ min: 0, tooltip: 'Hệ số scale bọt riêng cho vùng này.' })
    public foamScale = 1;
}

/** Lưới phủ diện tích của một vùng. */
class SprayTargetState {
    public readonly foams: Node[] = [];
    public cols = 0;
    public rows = 0;
    /** 1 = ô nằm trong hình dạng vùng (được tính diện tích). */
    public valid: Uint8Array = new Uint8Array(0);
    public covered: Uint8Array = new Uint8Array(0);
    public validCount = 0;
    public coveredCount = 0;

    constructor(public readonly config: SprayFoamTarget) { }

    public get AreaNode(): Node | null {
        return this.config.area?.isValid ? this.config.area : this.config.foamParent;
    }

    public get Coverage(): number {
        return this.validCount > 0 ? this.coveredCount / this.validCount : 0;
    }

    public get IsDone(): boolean {
        return this.validCount > 0 && this.Coverage >= this.config.requiredCoverage;
    }

    public get IsFull(): boolean {
        return this.IsDone || this.foams.length >= Math.max(1, this.config.maxFoamCount);
    }
}

/**
 * Bình xịt bọt.
 * - Kéo bình: sprayPoint (SprayPos) trúng vùng target -> bật particle xịt.
 * - Đang xịt trúng -> spawn bọt (FoamEffect từ pool) làm con của FoamMask. Mỗi bọt phủ một vòng tròn trên lưới diện tích;
 *   bọt chỉ spawn nếu phủ thêm ô mới (tránh chồng bọt).
 * - Mỗi vùng phủ đủ requiredCoverage -> xong vùng; tất cả xong -> ItemCleanManager.ItemCleanDone.
 */
@ccclass('SprayBottle')
export class SprayBottle extends Item {
    @property({ type: Node, tooltip: 'Điểm xịt (SprayPos).' })
    public sprayPoint: Node | null = null;

    @property({ type: [ParticleSystem2D], tooltip: 'Particle tia xịt, chỉ bật khi sprayPoint đang trúng vùng target.' })
    public sprayParticles: ParticleSystem2D[] = [];

    @property({ type: [SprayFoamTarget], tooltip: 'Các vùng nhận bọt (mỗi sandbox 1 vùng).' })
    public targets: SprayFoamTarget[] = [];

    @property({ min: 4, step: 1, tooltip: 'Số ô lưới theo chiều ngang của mỗi vùng (chiều dọc tự tính theo tỉ lệ).' })
    public coverageGridSize = 24;

    @property({ tooltip: 'Chỉ tính diện tích phần có hình (alpha) của Sprite trên vùng (ví dụ sprite của FoamMask).' })
    public useAreaSpriteShape = true;

    @property({ min: 0, max: 255, step: 1, tooltip: 'Alpha tối thiểu để 1 ô được tính là nằm trong hình dạng vùng.' })
    public shapeAlphaThreshold = 20;

    @property({ min: 0.1, tooltip: 'Hệ số bán kính phủ của mỗi bọt so với kích thước thật của bọt.' })
    public coverRadiusFactor = 0.8;

    @property({ min: 0, tooltip: 'Khoảng cách tối thiểu (world) giữa 2 bọt trong cùng 1 vùng.' })
    public minFoamSpacing = 35;

    @property({ min: 0, tooltip: 'Thời gian tối thiểu giữa 2 lần spawn bọt (giây).' })
    public spawnInterval = 0.06;

    @property({ min: 0, tooltip: 'Bọt spawn lệch ngẫu nhiên quanh sprayPoint trong bán kính này (world).' })
    public spawnJitter = 30;

    @property({ tooltip: 'Loop sound khi đang xịt trúng.' })
    public playSpraySound = true;

    @property({ type: Enum(FxType) })
    public sprayFxType: FxType = FxType.WaterStream;

    @property({ type: ItemCleanManager, tooltip: 'Để trống sẽ dùng ItemCleanManager.Ins.' })
    public itemCleanManager: ItemCleanManager | null = null;

    @property({ type: Ply_Event, tooltip: 'Gọi mỗi khi spawn 1 bọt.' })
    public onFoamSpawned: Ply_Event = new Ply_Event();

    @property({ type: Ply_Event, tooltip: 'Gọi khi mọi vùng đã phủ đủ bọt.' })
    public onAllTargetsFoamed: Ply_Event = new Ply_Event();

    private _states: SprayTargetState[] = [];
    private _isDragging = false;
    private _isSpraying = false;
    private _isPlayingSound = false;
    private _sprayedInDrag = false;
    private _isCompleted = false;
    private _spawnCooldown = 0;
    private readonly _point = new Vec3();
    private readonly _candidate = new Vec3();
    private readonly _tempLocal = new Vec3();

    private static readonly _shapeCache = new Map<SpriteFrame, Uint8ClampedArray | null>();

    private _boundOnDragStart = () => this.onDragStart();
    private _boundOnDropFail = () => this.onDropFail();
    private _boundOnDragEnd = () => this.onDragEnd();

    protected onLoad(): void {
        super.onLoad();
        this.allowHandTutDragWithoutTargetType = true;
        if (!this.itemDraggable) this.itemDraggable = this.getComponent(ItemDraggable);
        this._states = this.targets.filter(t => t?.foamParent?.isValid).map(t => new SprayTargetState(t));
        this._states.forEach(state => this.buildGrid(state));
        this.stopSpray();
    }

    protected onEnable(): void {
        if (!this.itemDraggable) this.itemDraggable = this.getComponent(ItemDraggable);
        const draggable = this.itemDraggable;
        if (!draggable) return;
        draggable.onBeginDrag.addListener(this._boundOnDragStart);
        draggable.onDropFail.addListener(this._boundOnDropFail);
        draggable.onDropSuccess.addListener(this._boundOnDragEnd);
        draggable.onReturnToStartComplete.addListener(this._boundOnDragEnd);
    }

    protected onDisable(): void {
        const draggable = this.itemDraggable;
        if (draggable) {
            draggable.onBeginDrag.removeListener(this._boundOnDragStart);
            draggable.onDropFail.removeListener(this._boundOnDropFail);
            draggable.onDropSuccess.removeListener(this._boundOnDragEnd);
            draggable.onReturnToStartComplete.removeListener(this._boundOnDragEnd);
        }
        this.onDragEnd();
    }

    public resetInEditor(): void {
        super.resetInEditor();
        if (!this.onFoamSpawned) this.onFoamSpawned = new Ply_Event();
        if (!this.onAllTargetsFoamed) this.onAllTargetsFoamed = new Ply_Event();
    }

    /** Tỉ lệ phủ bọt (0..1) của từng vùng, theo thứ tự targets. */
    public GetCoverages(): number[] {
        return this._states.map(state => state.Coverage);
    }

    /** HandTut: chỉ vào vùng chưa phủ đủ bọt. */
    public GetHandTutTarget(): Node | null {
        const state = this._states.find(s => !s.IsFull && s.AreaNode?.activeInHierarchy);
        return state?.AreaNode ?? null;
    }

    private onDragStart(): void {
        if (!this.isCurrentCleanItem() || this._isCompleted) return;
        this._isDragging = true;
        this._sprayedInDrag = false;
        this._spawnCooldown = 0;
    }

    private onDragEnd(): void {
        this._isDragging = false;
        this.stopSpray();
    }

    private onDropFail(): void {
        this.onDragEnd();
        const draggable = this.itemDraggable;
        if (!draggable) return;

        // Đã xong: không BreakHeart. Nếu CleanToolSlide đang ép thả để bay xuống thì giữ nguyên vị trí.
        if (this._isCompleted) {
            draggable.ConsumeCurrentDropFail();
            // Tool ở lại scene (không CleanToolSlide ép thả) thì quay về chỗ cũ, không BreakHeart.
            if (draggable.returnToStartOnDragFailed) draggable.ReturnToStartWithoutHeart();
            return;
        }
        if (this._sprayedInDrag) {
            draggable.ConsumeCurrentDropFail();
            if (draggable.returnToStartOnDragFailed) draggable.ReturnToStartWithoutHeart();
        }
    }

    protected lateUpdate(dt: number): void {
        if (!this._isDragging) return;
        if (!this.itemDraggable?.IsDragging || !this.isCurrentCleanItem() || this._isCompleted) {
            this.onDragEnd();
            return;
        }

        (this.sprayPoint ?? this.node).getWorldPosition(this._point);
        const hit = this._states.find(s => this.isInsideShape(s, this._point));
        if (!hit) {
            this.stopSpray();
            return;
        }

        this.startSpray();
        this._sprayedInDrag = true;
        this._spawnCooldown -= dt;
        if (hit.IsFull || this._spawnCooldown > 0) return;

        if (this.trySpawnFoam(hit)) {
            this._spawnCooldown = this.spawnInterval;
            if (this._states.every(s => s.IsFull)) this.onAllFoamed();
        }
    }

    private trySpawnFoam(state: SprayTargetState): boolean {
        const parent = state.config.foamParent;
        if (!parent?.isValid) return false;

        // Thử vài vị trí lệch quanh điểm xịt; chọn vị trí nằm trong vùng,
        // đủ khoảng cách với bọt cũ và phủ thêm được ô mới.
        const estimatedRadius = this.estimateCoverRadius(state);
        for (let attempt = 0; attempt < 4; attempt++) {
            const angle = Math.random() * Math.PI * 2;
            const radius = Math.random() * this.spawnJitter;
            this._candidate.set(this._point.x + Math.cos(angle) * radius, this._point.y + Math.sin(angle) * radius, this._point.z);
            if (!this.isInsideShape(state, this._candidate) || !this.hasSpacing(state, this._candidate)) continue;
            if (this.countNewCells(state, this._candidate, estimatedRadius) === 0) continue;

            const foam = World.instance?.poolManager?.spawnType<FoamEffect>(PoolType.Foam, this._candidate);
            if (!foam) return false;

            foam.node.setParent(parent);
            foam.node.setWorldPosition(this._candidate);
            foam.node.setSiblingIndex(parent.children.length - 1);
            foam.PlaySpawn(state.config.foamScale);
            state.foams.push(foam.node);
            (this.itemCleanManager ?? ItemCleanManager.Ins as ItemCleanManager | null)?.ReportCleanAction(this._candidate);
            this.markCovered(state, this._candidate, foam.GetCoverRadius() * this.coverRadiusFactor);
            this.onFoamSpawned.invoke(foam.node);
            return true;
        }
        return false;
    }

    /** Ước lượng bán kính phủ trước khi spawn, dùng bọt đã có hoặc kích thước 1 ô. */
    private estimateCoverRadius(state: SprayTargetState): number {
        const last = state.foams[state.foams.length - 1];
        const foam = last?.getComponent('FoamEffect') as FoamEffect | null;
        if (foam) return foam.GetCoverRadius() * this.coverRadiusFactor;
        return this.getCellWorldSize(state);
    }

    // ---------------- Coverage grid ----------------

    private buildGrid(state: SprayTargetState): void {
        const area = state.AreaNode;
        const transform = area?.getComponent(UITransform);
        if (!area || !transform || transform.width <= 0 || transform.height <= 0) return;

        state.cols = Math.max(4, Math.round(this.coverageGridSize));
        state.rows = Math.max(4, Math.round(state.cols * transform.height / transform.width));
        const total = state.cols * state.rows;
        state.valid = new Uint8Array(total);
        state.covered = new Uint8Array(total);
        state.coveredCount = 0;
        state.validCount = 0;

        const sprite = this.useAreaSpriteShape ? area.getComponent(Sprite) : null;
        const shape = sprite?.spriteFrame ? this.getShapePixels(sprite.spriteFrame) : null;
        const frame = sprite?.spriteFrame ?? null;

        for (let row = 0; row < state.rows; row++) {
            for (let col = 0; col < state.cols; col++) {
                const u = (col + 0.5) / state.cols;
                const v = (row + 0.5) / state.rows;
                const inside = !shape || !frame || this.sampleAlpha(frame, shape, u, v) >= this.shapeAlphaThreshold;
                if (!inside) continue;
                state.valid[row * state.cols + col] = 1;
                state.validCount++;
            }
        }
    }

    /** u, v: 0..1 theo rect node, v tính từ dưới lên. */
    private sampleAlpha(frame: SpriteFrame, pixels: Uint8ClampedArray, u: number, v: number): number {
        const texture = frame.texture as Texture2D;
        const rect = frame.rect;
        if (frame.rotated) {
            // Atlas xoay 90 độ: hoán đổi trục khi đọc pixel.
            const x = Math.floor(rect.x + (1 - v) * rect.height);
            const y = Math.floor(rect.y + (1 - u) * rect.width);
            return pixels[(y * texture.width + x) * 4 + 3] ?? 0;
        }
        const x = Math.floor(rect.x + u * rect.width);
        const y = Math.floor(rect.y + (1 - v) * rect.height);
        return pixels[(y * texture.width + x) * 4 + 3] ?? 0;
    }

    private getShapePixels(frame: SpriteFrame): Uint8ClampedArray | null {
        if (SprayBottle._shapeCache.has(frame)) return SprayBottle._shapeCache.get(frame)!;
        let pixels: Uint8ClampedArray | null = null;
        try {
            const image = (frame.texture as Texture2D)?.image;
            pixels = image ? readImagePixels(image) : null;
        } catch (error) {
            console.warn('[SprayBottle] Không đọc được alpha của sprite vùng, dùng toàn bộ hình chữ nhật.', error);
        }
        SprayBottle._shapeCache.set(frame, pixels);
        return pixels;
    }

    /** Đổi điểm world sang ô lưới; trả về -1 nếu nằm ngoài. */
    private getCellIndex(state: SprayTargetState, worldPoint: Vec3): number {
        const transform = state.AreaNode?.getComponent(UITransform);
        if (!transform || state.cols === 0) return -1;
        transform.convertToNodeSpaceAR(worldPoint, this._tempLocal);
        const u = (this._tempLocal.x + transform.anchorX * transform.width) / transform.width;
        const v = (this._tempLocal.y + transform.anchorY * transform.height) / transform.height;
        if (u < 0 || u >= 1 || v < 0 || v >= 1) return -1;
        return Math.floor(v * state.rows) * state.cols + Math.floor(u * state.cols);
    }

    private getCellWorldSize(state: SprayTargetState): number {
        const area = state.AreaNode;
        const transform = area?.getComponent(UITransform);
        if (!area || !transform || state.cols === 0) return 0;
        return transform.width / state.cols * Math.abs(area.worldScale.x);
    }

    /** Duyệt các ô có tâm nằm trong vòng tròn (world). */
    private forEachCellInCircle(state: SprayTargetState, worldCenter: Vec3, worldRadius: number, visit: (index: number) => void): void {
        const area = state.AreaNode;
        const transform = area?.getComponent(UITransform);
        if (!area || !transform || state.cols === 0) return;

        transform.convertToNodeSpaceAR(worldCenter, this._tempLocal);
        const cx = (this._tempLocal.x + transform.anchorX * transform.width) / transform.width * state.cols;
        const cy = (this._tempLocal.y + transform.anchorY * transform.height) / transform.height * state.rows;
        const scale = Math.max(0.0001, Math.abs(area.worldScale.x));
        const rx = worldRadius / scale / transform.width * state.cols;
        const ry = worldRadius / scale / transform.height * state.rows;

        const minCol = Math.max(0, Math.floor(cx - rx));
        const maxCol = Math.min(state.cols - 1, Math.ceil(cx + rx));
        const minRow = Math.max(0, Math.floor(cy - ry));
        const maxRow = Math.min(state.rows - 1, Math.ceil(cy + ry));
        for (let row = minRow; row <= maxRow; row++) {
            const dy = (row + 0.5 - cy) / Math.max(0.0001, ry);
            for (let col = minCol; col <= maxCol; col++) {
                const dx = (col + 0.5 - cx) / Math.max(0.0001, rx);
                if (dx * dx + dy * dy <= 1) visit(row * state.cols + col);
            }
        }
    }

    private countNewCells(state: SprayTargetState, worldCenter: Vec3, worldRadius: number): number {
        let count = 0;
        this.forEachCellInCircle(state, worldCenter, worldRadius, index => {
            if (state.valid[index] && !state.covered[index]) count++;
        });
        return count;
    }

    private markCovered(state: SprayTargetState, worldCenter: Vec3, worldRadius: number): void {
        this.forEachCellInCircle(state, worldCenter, worldRadius, index => {
            if (!state.valid[index] || state.covered[index]) return;
            state.covered[index] = 1;
            state.coveredCount++;
        });
    }

    private isInsideShape(state: SprayTargetState, worldPoint: Vec3): boolean {
        const area = state.AreaNode;
        if (!area?.isValid || !area.activeInHierarchy) return false;
        const index = this.getCellIndex(state, worldPoint);
        return index >= 0 && state.valid[index] === 1;
    }

    // ------------------------------------------------

    private hasSpacing(state: SprayTargetState, worldPos: Vec3): boolean {
        const minSq = this.minFoamSpacing * this.minFoamSpacing;
        for (const foam of state.foams) {
            const p = foam.worldPosition;
            const dx = p.x - worldPos.x;
            const dy = p.y - worldPos.y;
            if (dx * dx + dy * dy < minSq) return false;
        }
        return true;
    }

    private onAllFoamed(): void {
        this._isCompleted = true;
        this.isDone = true;
        this.stopSpray();
        this.onAllTargetsFoamed.invoke();
        (this.itemCleanManager ?? ItemCleanManager.Ins as ItemCleanManager | null)?.ItemCleanDone();
    }

    private startSpray(): void {
        if (this._isSpraying) return;
        this._isSpraying = true;
        for (const particle of this.sprayParticles) {
            if (!particle) continue;
            particle.node.active = true;
            particle.resetSystem();
        }
        if (this.playSpraySound && Ply_SoundManager.Ins) {
            Ply_SoundManager.Ins.PlayFxLoop(this.sprayFxType);
            this._isPlayingSound = true;
        }
    }

    private stopSpray(): void {
        for (const particle of this.sprayParticles) {
            if (particle?.isValid) particle.stopSystem();
        }
        this._isSpraying = false;
        if (this._isPlayingSound) {
            Ply_SoundManager.Ins?.StopFxLoop(this.sprayFxType);
            this._isPlayingSound = false;
        }
    }

    private isCurrentCleanItem(): boolean {
        const manager = this.itemCleanManager ?? ItemCleanManager.Ins as ItemCleanManager | null;
        if (!manager) return true;
        return this.onProcess && manager.currentItemIndex >= 0
            && manager.items[manager.currentItemIndex] === this.node;
    }

    /** Không spawn BreakHeart nếu lượt kéo này đã xịt trúng. */
    public SpawnBreakHeart(): void {
        if (!this._sprayedInDrag && !this._isCompleted) super.SpawnBreakHeart();
    }

    public OnDragFailReturnComplete(): void {
        if (!this._sprayedInDrag && !this._isCompleted) super.OnDragFailReturnComplete();
    }
}
