import { _decorator, Node, ParticleSystem2D, UITransform, Vec3, Enum } from 'cc';
import { Item } from '../Items/Components/Item';
import { ItemDraggable } from '../Items/Components/ItemDraggable';
import { ItemCleanManager } from '../Systems/ItemCleanManager';
import { Ply_SoundManager, FxType } from '../Framework/Ply_SoundManager';
import { Ply_Event } from '../Framework/Ply_Event';
import { FoamEffect } from '../Effects/FoamEffect';
import { DirtCleaner } from './DirtCleaner';

const { ccclass, property } = _decorator;

/**
 * Vòi sen rửa nhiều sandbox cùng lúc.
 * - Kéo vòi: brushPoint trúng vùng soap -> bật particle nước.
 * - Quét tới đâu: DirtCleaner (CleanMat) làm mờ soap_sandbox tới đó, tắt SoapPTC và làm mờ bọt (FoamEffect) quanh đó.
 * - Tất cả DirtCleaner hoàn thành -> dọn nốt particle/bọt còn lại -> ItemCleanManager.ItemCleanDone.
 */
@ccclass('SandBoxShower')
export class SandBoxShower extends Item {
    @property({ type: Node, tooltip: 'Điểm nước chạm (ShowerPos). Để trống sẽ dùng node shower.' })
    public brushPoint: Node | null = null;

    @property({ type: [ParticleSystem2D], tooltip: 'Particle nước, chỉ bật khi brushPoint đang trúng vùng rửa.' })
    public waterParticles: ParticleSystem2D[] = [];

    @property({ type: [DirtCleaner], tooltip: 'DirtCleaner trên các soap_sandbox (cần material CleanMat + DirtMaskRenderer).' })
    public cleaners: DirtCleaner[] = [];

    @property({ type: [Node], tooltip: 'Node cha chứa SoapPTC của các sandbox (Soaps). Particle nào nằm trong bán kính sẽ bị tắt.' })
    public soapParticleRoots: Node[] = [];

    @property({ type: [Node], tooltip: 'Node cha chứa bọt (FoamMask). Bọt nằm trong bán kính sẽ mờ đi.' })
    public foamParents: Node[] = [];

    @property({ min: 0, tooltip: 'Bán kính (world) tắt SoapPTC quanh brushPoint.' })
    public particleClearRadius = 90;

    @property({ min: 0, tooltip: 'Bán kính (world) làm mờ bọt quanh brushPoint.' })
    public foamClearRadius = 90;

    @property({ min: 0.01, tooltip: 'Thời gian bọt mờ đi khi bị rửa (giây).' })
    public foamFadeDuration = 0.4;

    @property({ tooltip: 'Loop sound khi đang xịt nước trúng.' })
    public playWaterSound = true;

    @property({ type: Enum(FxType) })
    public waterFxType: FxType = FxType.WaterStream;

    @property({ type: ItemCleanManager, tooltip: 'Để trống sẽ dùng ItemCleanManager.Ins.' })
    public itemCleanManager: ItemCleanManager | null = null;

    @property({ type: Ply_Event, tooltip: 'Gọi khi đã rửa sạch tất cả sandbox.' })
    public onShowerComplete: Ply_Event = new Ply_Event();

    private _isDragging = false;
    private _isWatering = false;
    private _isPlayingSound = false;
    private _washedInDrag = false;
    private _isCompleted = false;
    private readonly _lastPoint = new Vec3();
    private readonly _point = new Vec3();
    private readonly _tempLocal = new Vec3();
    private readonly _stoppedParticles = new Set<ParticleSystem2D>();

    private _boundOnDragStart = () => this.onDragStart();
    private _boundOnDropFail = () => this.onDropFail();
    private _boundOnDragEnd = () => this.onDragEnd();

    protected onLoad(): void {
        super.onLoad();
        this.allowHandTutDragWithoutTargetType = true;
        if (!this.itemDraggable) this.itemDraggable = this.getComponent(ItemDraggable);
        this.stopWater();
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
        if (!this.onShowerComplete) this.onShowerComplete = new Ply_Event();
    }

    /** HandTut: chỉ vào soap_sandbox chưa rửa xong. */
    public GetHandTutTarget(): Node | null {
        return this.getActiveCleaners().find(c => !c.IsCompleted)?.node ?? null;
    }

    private onDragStart(): void {
        if (!this.isCurrentCleanItem() || this._isCompleted) return;
        this._isDragging = true;
        this._washedInDrag = false;
        (this.brushPoint ?? this.node).getWorldPosition(this._lastPoint);
    }

    private onDragEnd(): void {
        this._isDragging = false;
        this.stopWater();
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
        if (this._washedInDrag) {
            draggable.ConsumeCurrentDropFail();
            if (draggable.returnToStartOnDragFailed) draggable.ReturnToStartWithoutHeart();
        }
    }

    protected lateUpdate(): void {
        if (!this._isDragging) return;
        if (!this.itemDraggable?.IsDragging || !this.isCurrentCleanItem() || this._isCompleted) {
            this.onDragEnd();
            return;
        }

        (this.brushPoint ?? this.node).getWorldPosition(this._point);
        const cleaners = this.getActiveCleaners();
        const isOverTarget = cleaners.some(c => c.IsPointInsideCleanArea(this._point))
            || this.foamParents.some(p => this.isInsideArea(this._point, p));

        if (!isOverTarget) {
            this.stopWater();
            this._lastPoint.set(this._point);
            return;
        }

        this.startWater();
        this._washedInDrag = true;
        (this.itemCleanManager ?? ItemCleanManager.Ins as ItemCleanManager | null)?.ReportCleanAction(this._point);
        for (const cleaner of cleaners) {
            if (!cleaner.IsCompleted) cleaner.sweepBetween(this._lastPoint, this._point);
        }
        this.clearSoapParticles(this._point, this.particleClearRadius);
        this.clearFoams(this._point, this.foamClearRadius);
        this._lastPoint.set(this._point);

        if (cleaners.length > 0 && cleaners.every(c => c.IsCompleted)) this.onAllWashed();
    }

    private onAllWashed(): void {
        this._isCompleted = true;
        this.isDone = true;
        this.stopWater();
        // Rửa nốt phần particle/bọt còn sót.
        this.clearSoapParticles(null, 0);
        this.clearFoams(null, 0);
        this.onShowerComplete.invoke();
        (this.itemCleanManager ?? ItemCleanManager.Ins as ItemCleanManager | null)?.ItemCleanDone();
    }

    /** center = null: dọn toàn bộ. */
    private clearSoapParticles(center: Vec3 | null, radius: number): void {
        const radiusSq = radius * radius;
        for (const root of this.soapParticleRoots) {
            if (!root?.isValid) continue;
            for (const particle of root.getComponentsInChildren(ParticleSystem2D)) {
                if (this._stoppedParticles.has(particle)) continue;
                if (center && this.distanceSq(center, particle.node.worldPosition) > radiusSq) continue;
                particle.stopSystem();
                this._stoppedParticles.add(particle);
            }
        }
    }

    /** center = null: làm mờ toàn bộ bọt. */
    private clearFoams(center: Vec3 | null, radius: number): void {
        const radiusSq = radius * radius;
        for (const parent of this.foamParents) {
            if (!parent?.isValid) continue;
            // Copy danh sách vì bọt sẽ rời parent khi trả về pool.
            for (const child of [...parent.children]) {
                const foam = child.getComponent(FoamEffect);
                if (!foam || foam.IsFading) continue;
                if (center && this.distanceSq(center, child.worldPosition) > radiusSq) continue;
                foam.FadeOut(this.foamFadeDuration);
            }
        }
    }

    private getActiveCleaners(): DirtCleaner[] {
        return this.cleaners.filter(c => c?.isValid && c.node.activeInHierarchy);
    }

    private startWater(): void {
        if (this._isWatering) return;
        this._isWatering = true;
        for (const particle of this.waterParticles) {
            if (!particle) continue;
            particle.node.active = true;
            particle.resetSystem();
        }
        if (this.playWaterSound && Ply_SoundManager.Ins) {
            Ply_SoundManager.Ins.PlayFxLoop(this.waterFxType);
            this._isPlayingSound = true;
        }
    }

    private stopWater(): void {
        for (const particle of this.waterParticles) {
            if (particle?.isValid) particle.stopSystem();
        }
        this._isWatering = false;
        if (this._isPlayingSound) {
            Ply_SoundManager.Ins?.StopFxLoop(this.waterFxType);
            this._isPlayingSound = false;
        }
    }

    private distanceSq(a: Vec3, b: Vec3): number {
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        return dx * dx + dy * dy;
    }

    private isInsideArea(worldPoint: Vec3, area: Node | null): boolean {
        if (!area?.isValid || !area.activeInHierarchy) return false;
        const transform = area.getComponent(UITransform);
        if (!transform) return false;
        transform.convertToNodeSpaceAR(worldPoint, this._tempLocal);
        const left = -transform.anchorX * transform.width;
        const bottom = -transform.anchorY * transform.height;
        return this._tempLocal.x >= left && this._tempLocal.x <= left + transform.width
            && this._tempLocal.y >= bottom && this._tempLocal.y <= bottom + transform.height;
    }

    private isCurrentCleanItem(): boolean {
        const manager = this.itemCleanManager ?? ItemCleanManager.Ins as ItemCleanManager | null;
        if (!manager) return true;
        return this.onProcess && manager.currentItemIndex >= 0
            && manager.items[manager.currentItemIndex] === this.node;
    }

    /** Không spawn BreakHeart nếu lượt kéo này đã rửa trúng. */
    public SpawnBreakHeart(): void {
        if (!this._washedInDrag && !this._isCompleted) super.SpawnBreakHeart();
    }

    public OnDragFailReturnComplete(): void {
        if (!this._washedInDrag && !this._isCompleted) super.OnDragFailReturnComplete();
    }
}
