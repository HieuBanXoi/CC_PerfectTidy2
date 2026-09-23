import { _decorator, Enum, Node, ParticleSystem2D, Vec3 } from 'cc';
import { Item } from '../Components/Item';
import { ItemDraggable } from '../Components/ItemDraggable';
import { ItemCleanManager } from '../../Systems/ItemCleanManager';
import { FxType, Ply_SoundManager } from '../../Framework/Ply_SoundManager';
import { World } from '../../../Core/Managers/World';
import { PoolType } from '../../../Core/Pooling/PoolMember';
import { StarSpark } from '../../Effects/StarSpark';
import { Web } from './Web';

const { ccclass, property } = _decorator;

/** Sweeps Web items with the moving brush point of a draggable tool. */
@ccclass('WebCleaner')
export class WebCleaner extends Item {
    @property({ type: Node, tooltip: 'Brush tip used to test and sweep webs.' })
    public brushPoint: Node | null = null;

    @property({ type: ItemDraggable, tooltip: 'Draggable tool that controls this cleaner.' })
    public itemDraggable: ItemDraggable | null = null;

    @property({ type: [Web], tooltip: 'Webs this cleaner can sweep. Leave empty to find all active Web components in the scene.' })
    public webs: Web[] = [];

    @property({ type: ItemCleanManager, tooltip: 'Called once after every configured web has been swept.' })
    public itemCleanManager: ItemCleanManager | null = null;

    @property({ min: 0, tooltip: 'Extra hit area around each web, in UI units.' })
    public hitPadding = 0;

    @property({ tooltip: 'Play a looping sound while the brush is sweeping a web.' })
    public playSweepSound = true;

    @property({ type: Enum(FxType), tooltip: 'Sound effect used while sweeping a web.' })
    public sweepFxType: FxType = FxType.Clean1;

    @property({ type: ParticleSystem2D, tooltip: 'Particle trail at the brush tip while sweeping a web.' })
    public trailParticle: ParticleSystem2D | null = null;

    private isDragging = false;
    private activeWeb: Web | null = null;
    private lastBrushWorldPosition = new Vec3();
    private currentBrushWorldPosition = new Vec3();
    private hasCompletedAllWebs = false;
    private isTrailPlaying = false;
    private isSweepSoundPlaying = false;
    private readonly onDragStartBound = () => this.OnDragStart();
    private readonly onDragEndBound = () => this.OnDragEnd();

    protected onLoad(): void {
        super.onLoad();
        this.allowHandTutDragWithoutTargetType = true;
        this.itemDraggable ??= this.getComponent(ItemDraggable);
        if (this.webs.length === 0) {
            this.webs = (this.node.scene?.getComponentsInChildren(Web) ?? []) as Web[];
        }
        this.UpdateHandTutTarget();
        this.itemCleanManager ??= ItemCleanManager.Ins as ItemCleanManager | null;
        this.trailParticle ??= this.brushPoint?.getComponentInChildren(ParticleSystem2D) ?? null;
        this.StopTrailParticle();
        this.StopSweepSound();
    }

    protected onEnable(): void {
        this.itemDraggable ??= this.getComponent(ItemDraggable);
        this.itemDraggable?.onBeginDrag.addListener(this.onDragStartBound);
        this.itemDraggable?.onDropSuccess.addListener(this.onDragEndBound);
        this.itemDraggable?.onDropFail.addListener(this.onDragEndBound);
        this.itemDraggable?.onReturnToStartComplete.addListener(this.onDragEndBound);
    }

    protected onDisable(): void {
        this.itemDraggable?.onBeginDrag.removeListener(this.onDragStartBound);
        this.itemDraggable?.onDropSuccess.removeListener(this.onDragEndBound);
        this.itemDraggable?.onDropFail.removeListener(this.onDragEndBound);
        this.itemDraggable?.onReturnToStartComplete.removeListener(this.onDragEndBound);
        this.OnDragEnd();
    }

    protected lateUpdate(_dt: number): void {
        if (!this.isDragging) return;
        if (this.itemDraggable && !this.itemDraggable.IsDragging) {
            this.OnDragEnd();
            return;
        }

        const brush = this.brushPoint ?? this.node;
        brush.getWorldPosition(this.currentBrushWorldPosition);
        const movementDistance = Vec3.distance(this.lastBrushWorldPosition, this.currentBrushWorldPosition);
        if (movementDistance <= 0) {
            this.activeWeb?.StopDebris();
            this.StopSweepSound();
            return;
        }

        const web = this.FindWebAt(this.currentBrushWorldPosition);
        if (web !== this.activeWeb) {
            this.activeWeb?.StopDebris();
            this.activeWeb = web;
        }

        // A stationary cleaner on a web does not shrink it. Sweep is called
        // only after the brush position has actually changed.
        this.SweepActiveWeb(movementDistance);
        if (!this.activeWeb) this.StopSweepSound();
        this.UpdateTrailParticle();
        this.lastBrushWorldPosition.set(this.currentBrushWorldPosition);
    }

    private OnDragStart(): void {
        this.isDragging = true;
        this.StopSweepSound();
        const brush = this.brushPoint ?? this.node;
        brush.getWorldPosition(this.lastBrushWorldPosition);
        this.activeWeb = this.FindWebAt(this.lastBrushWorldPosition);
        // Entering a web at the start of a drag removes one small amount;
        // remaining there will not remove more until the cleaner moves.
        this.SweepActiveWeb(this.activeWeb?.minimumMovementDistance ?? 0);
        this.UpdateTrailParticle();
    }

    private OnDragEnd(): void {
        this.isDragging = false;
        this.activeWeb?.StopDebris();
        this.activeWeb = null;
        this.StopSweepSound();
        this.StopTrailParticle();
    }

    private FindWebAt(worldPosition: Vec3): Web | null {
        for (let index = this.webs.length - 1; index >= 0; index--) {
            const web = this.webs[index];
            if (!web || !web.isValid || !web.node.activeInHierarchy || web.isCleaned) continue;
            if (web.IsPointInsideWeb(worldPosition, this.hitPadding)) return web;
        }
        return null;
    }

    private SweepActiveWeb(movementDistance: number): void {
        const web = this.activeWeb;
        if (!web) return;

        const wasCleaned = web.isCleaned;
        web.Sweep(movementDistance);
        if (!web.isCleaned && movementDistance >= web.minimumMovementDistance) {
            this.StartSweepSound();
        } else if (web.isCleaned) {
            this.StopSweepSound();
        }
        if (wasCleaned || !web.isCleaned) return;

        this.SpawnWebCleanEffect(web);
        this.UpdateHandTutTarget();
        this.TryCompleteAllWebs();
    }

    /** Completes the cleaning step once every configured valid Web is clean. */
    private TryCompleteAllWebs(): void {
        if (this.hasCompletedAllWebs) return;

        const validWebs = this.webs.filter(web => !!web && web.isValid);
        if (validWebs.length === 0 || !validWebs.every(web => web.isCleaned)) return;

        this.hasCompletedAllWebs = true;
        this.ItemDone();
        (this.itemCleanManager ?? ItemCleanManager.Ins as ItemCleanManager | null)?.ItemCleanDone(this);
    }

    /** Points Item's drag tutorial at the next web that still needs sweeping. */
    private UpdateHandTutTarget(): void {
        if (!this.itemMoveToTarget) return;
        const tutorialWeb = this.webs.find(web =>
            !!web && web.isValid && web.node.activeInHierarchy && !web.isCleaned,
        );
        if (tutorialWeb?.node) {
            this.itemMoveToTarget.defaultTarget = tutorialWeb.node;
        }
    }

    private UpdateTrailParticle(): void {
        if (!this.trailParticle) return;
        // Keep the trail emitting through the entire drag, rather than
        // allowing a one-shot particle configuration to finish.
        this.trailParticle.node.active = true;
        this.trailParticle.enabled = true;
        this.trailParticle.duration = -1;
        this.trailParticle.autoRemoveOnFinish = false;
        this.BringTrailToFront();
        if (this.isTrailPlaying) {
            return;
        }

        this.trailParticle.resetSystem();
        this.isTrailPlaying = true;
    }

    private StopTrailParticle(): void {
        if (!this.trailParticle) return;
        this.trailParticle.stopSystem();
        this.isTrailPlaying = false;
    }

    private StartSweepSound(): void {
        if (!this.playSweepSound || this.isSweepSoundPlaying) return;
        if (!Ply_SoundManager.Ins) return;
        Ply_SoundManager.Ins.PlayFxLoop(this.sweepFxType);
        this.isSweepSoundPlaying = true;
    }

    private StopSweepSound(): void {
        if (!this.isSweepSoundPlaying) return;
        Ply_SoundManager.Ins?.StopFxLoop(this.sweepFxType);
        this.isSweepSoundPlaying = false;
    }

    private SpawnWebCleanEffect(web: Web): void {
        const effect = World.instance?.poolManager?.spawnType<StarSpark>(PoolType.StarVFX, web.node.worldPosition);
        if (!effect) return;

        effect.node.setParent(web.node);
        effect.node.setPosition(0, 0, 0);
        effect.PlaySpawn();
    }

    private BringTrailToFront(): void {
        // Keep the brush-point particle above the cleaner model in UI render
        // order while preserving its local position and movement hierarchy.
        const trailRoot = this.brushPoint?.parent === this.node ? this.brushPoint : this.trailParticle?.node;
        const parent = trailRoot?.parent;
        if (trailRoot && parent && trailRoot.getSiblingIndex() !== parent.children.length - 1) {
            trailRoot.setSiblingIndex(parent.children.length - 1);
        }
    }
}
