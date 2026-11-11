import { _decorator, Node, ParticleSystem2D, Sprite, SpriteFrame, Tween, tween, UIOpacity, UITransform, Vec3, Enum } from 'cc';
import { Item } from '../Items/Components/Item';
import { ItemDraggable } from '../Items/Components/ItemDraggable';
import { ItemCleanManager } from '../Systems/ItemCleanManager';
import { Ply_Event } from '../Framework/Ply_Event';
import { Ply_SoundManager, FxType } from '../Framework/Ply_SoundManager';
import { CleaningSoundMode } from './CleaningSoundMode';

const { ccclass, property } = _decorator;

class SoapTargetState {
    public hitCount = 0;
    public isActivated = false;
    public wasInsideInLastFrame = false;
    public scrubTime = 0;

    constructor(public readonly node: Node) { }
}

/**
 * Drag soap over target nodes. Each completed target is activated and plays
 * its own ParticleSystem2D (or the first ParticleSystem2D found below it).
 */
@ccclass('SoapAdd')
export class SoapAdd extends Item {
    @property({ type: Node, tooltip: 'Đầu quét xà phòng. Để trống sẽ dùng node SoapAdd.' })
    public brushPoint: Node = null!;

    @property({ tooltip: 'Bán kính quét xà phòng tại brushPoint (world units/pixels).' })
    public soapRadius = 30;

    @property({ type: [Node], tooltip: 'Các điểm target để brush quét qua và kích hoạt xà phòng.' })
    public targetNodes: Node[] = [];

    @property({ min: 1, step: 1, tooltip: 'Số lần brush đi vào target để kích hoạt particle.' })
    public hitsToActivate = 1;

    @property({ min: 0, tooltip: 'Thời gian (giây) phải chà qua lại trong bán kính của 1 target mới kích hoạt. > 0 thì dùng chế độ này thay cho hitsToActivate.' })
    public scrubTimeToActivate = 0;

    @property({ min: 0, tooltip: 'Brush phải di chuyển tối thiểu (world/frame) thì mới tính là đang chà.' })
    public scrubMinMove = 1;

    @property({ tooltip: 'Play a sound when a soap target is activated.' })
    public playCutSound: boolean = true;

    @property({ type: Enum(FxType), tooltip: 'Sound played when a soap target is activated.' })
    public cutFxType: FxType = FxType.Clean2;

    @property({ tooltip: 'Play a loop while dragging soap.' })
    public playDragSound: boolean = true;

    @property({ type: Enum(FxType), tooltip: 'Loop sound while dragging soap.' })
    public dragFxType: FxType = FxType.Clean1;

    @property({ type: Enum(CleaningSoundMode), tooltip: 'When the drag loop sound is audible.' })
    public dragSoundMode: CleaningSoundMode = CleaningSoundMode.Always;

    @property({ type: ParticleSystem2D, tooltip: 'Particle trail ở đầu SoapAdd. Tự lấy ParticleSystem2D con của Brush Point nếu để trống.' })
    public trailParticle: ParticleSystem2D | null = null;

    @property({ tooltip: 'Trail particle chỉ phun khi đang chà (brush di chuyển trong Scrub Area). Tắt: phun suốt lúc kéo.' })
    public trailOnlyWhenScrubbing = false;

    @property({ type: Node, tooltip: 'Vùng tính là đang chà (theo UITransform, ví dụ thân nhân vật). Để trống: chỉ cần brush đang di chuyển.', visible(this: SoapAdd) { return this.trailOnlyWhenScrubbing; } })
    public scrubArea: Node | null = null;

    @property({ min: 0, tooltip: 'Emission rate của trail particle khi đang chà.', visible(this: SoapAdd) { return this.trailOnlyWhenScrubbing; } })
    public scrubTrailEmissionRate = 20;

    @property({ tooltip: 'Khi kích hoạt target chỉ bật Sprite bọt con (pop lên), KHÔNG play particle. Dùng cho bước bóp bình xà phòng.' })
    public activateSpriteOnly = false;

    @property({ type: [Node], tooltip: 'Các điểm bọt dạng Sprite (đã được bước trước bật lên). Brush đi qua 1 lần là Sprite mờ đi và particle con được play. Bước chỉ xong khi đã chuyển hết.' })
    public convertTargets: Node[] = [];

    @property({ type: SpriteFrame, tooltip: 'Sprite bọt rơi xuống khi đang chà (brush di chuyển trong Scrub Area). Để trống = tắt.' })
    public scrubDropSprite: SpriteFrame | null = null;

    @property({ type: Node, tooltip: 'Node cha chứa các bọt rơi (đứng yên, không đi theo brush).' })
    public scrubDropLayer: Node | null = null;

    @property({ min: 0.01, tooltip: 'Khoảng thời gian giữa 2 bọt rơi khi đang chà (giây).' })
    public scrubDropInterval = 0.07;

    @property({ tooltip: 'Kích thước bọt rơi (world px).' })
    public scrubDropSize = 45;

    @property({ tooltip: 'Độ chênh kích thước ngẫu nhiên (world px).' })
    public scrubDropSizeVar = 15;

    @property({ tooltip: 'Quãng rơi (world px).' })
    public scrubDropFall = 220;

    @property({ min: 0.05, tooltip: 'Thời gian rơi + mờ dần (giây).' })
    public scrubDropDuration = 0.8;

    @property({ type: [Node], tooltip: 'Các node được bật (hiện dần) khi tất cả target đã kích hoạt (ví dụ soap_sandbox).' })
    public showOnAllDone: Node[] = [];

    @property({ type: [Node], tooltip: 'Các node bị tắt (mờ dần) khi tất cả target đã kích hoạt (ví dụ dirty_sandbox).' })
    public hideOnAllDone: Node[] = [];

    @property({ min: 0, tooltip: 'Thời gian hiện/mờ của showOnAllDone/hideOnAllDone (giây). 0 = bật/tắt ngay.' })
    public toggleFadeDuration = 0.4;

    @property({ type: ItemCleanManager, tooltip: 'Manager điều phối lượt; chỉ hoạt động khi SoapAdd có onProcess.' })
    public itemCleanManager: ItemCleanManager | null = null;

    @property({ type: Ply_Event, tooltip: 'Gọi sau khi một target được kích hoạt particle.' })
    public onTargetActivated: Ply_Event = new Ply_Event();

    @property({ type: Ply_Event, tooltip: 'Gọi khi tất cả target đã được kích hoạt.' })
    public onAllTargetsActivated: Ply_Event = new Ply_Event();

    private targetStates: SoapTargetState[] = [];
    private isDraggingSoap = false;
    private hasActivatedTargetInCurrentDrag = false;
    private isTrailPlaying = false;
    private isDragSoundPlaying = false;
    private brushWorldPosition = new Vec3();
    private lastBrushWorldPosition = new Vec3();
    private hasLastBrushPosition = false;
    private targetWorldPosition = new Vec3();
    /** Thời gian còn giữ trạng thái "đang chà" sau lần di chuyển cuối (tránh nhấp nháy khi input không tới mỗi frame). */
    private scrubHoldTime = 0;
    private scrubDropTimer = 0;
    private readonly convertedTargets = new Set<Node>();
    private readonly scrubDropPool: Node[] = [];

    private readonly boundOnDragStart = () => this.onDragStart();
    private readonly boundOnDragEnd = () => this.onDragEnd();

    protected onLoad(): void {
        super.onLoad();
        this.allowHandTutDragWithoutTargetType = true;
        this.itemDraggable ??= this.getComponent(ItemDraggable);
        this.trailParticle ??= this.brushPoint?.getComponentInChildren(ParticleSystem2D) ?? null;
        this.initializeTargets();
        this.stopTrailParticle();
        // Bọt rơi dùng chung SpriteFrame với particle (SoapPTC). Nếu Sprite đẩy frame này vào
        // dynamic atlas thì UV/texture của frame bị đổi và particle vẽ sai vùng texture.
        if (this.scrubDropSprite) this.scrubDropSprite.packable = false;
        // Sprite bọt trên người dùng chung frame với particle SoapPTC: cũng không cho vào dynamic atlas.
        for (const node of [...this.targetNodes, ...this.convertTargets]) {
            const sprite = node?.isValid ? node.getComponentInChildren(Sprite) : null;
            if (sprite?.spriteFrame) sprite.spriteFrame.packable = false;
        }
    }

    protected onEnable(): void {
        this.itemDraggable ??= this.getComponent(ItemDraggable);
        this.itemDraggable?.onBeginDrag.addListener(this.boundOnDragStart);
        this.itemDraggable?.onDropSuccess.addListener(this.boundOnDragEnd);
        this.itemDraggable?.onDropFail.addListener(this.boundOnDragEnd);
        this.itemDraggable?.onReturnToStartComplete.addListener(this.boundOnDragEnd);
    }

    protected onDisable(): void {
        this.itemDraggable?.onBeginDrag.removeListener(this.boundOnDragStart);
        this.itemDraggable?.onDropSuccess.removeListener(this.boundOnDragEnd);
        this.itemDraggable?.onDropFail.removeListener(this.boundOnDragEnd);
        this.itemDraggable?.onReturnToStartComplete.removeListener(this.boundOnDragEnd);
        this.isDraggingSoap = false;
        this.stopDragSound();
        this.stopTrailParticle();
    }

    public initializeTargets(): void {
        this.targetStates = this.targetNodes
            .filter((node): node is Node => !!node && node.isValid)
            .map(node => new SoapTargetState(node));
    }

    /** Returns the next soap point that has not yet been activated. */
    public GetHandTutTarget(): Node | null {
        return this.targetStates.find(state => !state.isActivated && state.node.activeInHierarchy)?.node ?? null;
    }

    public onDragStart(): void {
        if (!this.isCurrentCleanManagerItem() || this.isDone) return;

        this.isDraggingSoap = true;
        this.hasLastBrushPosition = false;
        this.startDragSound();
        this.hasActivatedTargetInCurrentDrag = false;
        this.startTrailParticle();
        for (const state of this.targetStates) {
            state.wasInsideInLastFrame = false;
        }
        this.checkTargets();
    }

    public onDragEnd(): void {
        this.isDraggingSoap = false;
        this.hasLastBrushPosition = false;
        this.stopDragSound();
        this.stopTrailParticle();
        for (const state of this.targetStates) {
            state.wasInsideInLastFrame = false;
        }
    }

    protected lateUpdate(dt: number): void {
        if (!this.isDraggingSoap) return;
        if (!this.isCurrentCleanManagerItem() || (this.itemDraggable && !this.itemDraggable.IsDragging)) {
            this.onDragEnd();
            return;
        }
        this.checkTargets(dt);
    }

    private checkTargets(dt = 0): void {
        const brush = this.brushPoint || this.node;
        brush.getWorldPosition(this.brushWorldPosition);
        const isMoving = this.hasLastBrushPosition
            && Vec3.distance(this.brushWorldPosition, this.lastBrushWorldPosition) >= this.scrubMinMove;
        this.lastBrushWorldPosition.set(this.brushWorldPosition);
        this.hasLastBrushPosition = true;
        const radiusSq = this.soapRadius * this.soapRadius;
        let isOverAnyTarget = false;

        for (const state of this.targetStates) {
            if (state.isActivated || !state.node.isValid) continue;

            state.node.getWorldPosition(this.targetWorldPosition);
            const dx = this.brushWorldPosition.x - this.targetWorldPosition.x;
            const dy = this.brushWorldPosition.y - this.targetWorldPosition.y;
            const isInside = dx * dx + dy * dy <= radiusSq;
            if (isInside) isOverAnyTarget = true;
            if (this.scrubTimeToActivate > 0) {
                // Chà lâu: cộng dồn thời gian brush di chuyển trong bán kính target.
                if (isInside && isMoving) {
                    state.scrubTime += dt;
                    this.hasActivatedTargetInCurrentDrag = true;
                    if (state.scrubTime >= this.scrubTimeToActivate) this.activateTarget(state);
                }
            } else if (isInside && !state.wasInsideInLastFrame) {
                this.hitTarget(state);
            }
            state.wasInsideInLastFrame = isInside;
        }
        for (const node of this.convertTargets) {
            if (!node?.isValid || this.convertedTargets.has(node)) continue;
            const sprite = this.getFoamSprite(node);
            if (!sprite || !sprite.node.activeInHierarchy) continue;
            node.getWorldPosition(this.targetWorldPosition);
            const dx = this.brushWorldPosition.x - this.targetWorldPosition.x;
            const dy = this.brushWorldPosition.y - this.targetWorldPosition.y;
            if (dx * dx + dy * dy <= radiusSq) {
                isOverAnyTarget = true;
                this.convertTarget(node, sprite);
            }
        }
        this.updateDragSound(isOverAnyTarget);
        this.updateScrubTrail(isMoving, dt);
    }

    /** Bật/tắt emission của trail theo việc đang chà, không reset để bọt đang rơi không bị xoá. */
    private updateScrubTrail(isMoving: boolean, dt: number): void {
        if (!this.trailOnlyWhenScrubbing && !this.scrubDropSprite) return;
        const inArea = !this.scrubArea || this.isInsideNode(this.brushWorldPosition, this.scrubArea);
        // Giữ trạng thái chà thêm một chút sau lần di chuyển cuối để dòng bọt không bị đứt
        // khi input không tới đều mỗi frame hoặc tay khựng lại rất ngắn lúc đổi hướng chà.
        if (isMoving && inArea) this.scrubHoldTime = 0.3;
        else this.scrubHoldTime = Math.max(0, this.scrubHoldTime - dt);
        const scrubbing = this.scrubHoldTime > 0;

        if (this.trailOnlyWhenScrubbing && this.trailParticle) {
            this.trailParticle.emissionRate = scrubbing ? this.scrubTrailEmissionRate : 0;
        }
        if (this.scrubDropSprite && scrubbing) {
            // Bù số bọt theo dt để mật độ đều kể cả khi frame dài (FPS thấp).
            this.scrubDropTimer -= dt;
            let guard = 0;
            while (this.scrubDropTimer <= 0 && guard++ < 6) {
                this.scrubDropTimer += this.scrubDropInterval;
                this.spawnScrubDrop();
            }
            if (this.scrubDropTimer <= 0) this.scrubDropTimer = this.scrubDropInterval;
        }
    }

    /** Một cục bọt nhỏ rơi xuống từ đầu brush rồi mờ dần. */
    private spawnScrubDrop(): void {
        const layer = this.scrubDropLayer?.isValid ? this.scrubDropLayer : this.node.parent;
        if (!layer || !this.scrubDropSprite) return;

        let drop = this.scrubDropPool.pop();
        if (!drop || !drop.isValid) {
            drop = new Node('ScrubDrop');
            drop.addComponent(UITransform);
            const sprite = drop.addComponent(Sprite);
            sprite.sizeMode = Sprite.SizeMode.CUSTOM;
            drop.addComponent(UIOpacity);
        }
        drop.layer = layer.layer;
        if (drop.parent !== layer) drop.setParent(layer);
        drop.setSiblingIndex(layer.children.length - 1);
        drop.active = true;

        const sprite = drop.getComponent(Sprite)!;
        sprite.spriteFrame = this.scrubDropSprite;
        const parentScale = Math.abs(layer.worldScale.x) || 1;
        const size = Math.max(4, this.scrubDropSize + (Math.random() * 2 - 1) * this.scrubDropSizeVar) / parentScale;
        drop.getComponent(UITransform)!.setContentSize(size, size);
        drop.setScale(1, 1, 1);
        drop.angle = Math.random() * 360;

        const start = new Vec3(
            this.brushWorldPosition.x + (Math.random() * 2 - 1) * 40,
            this.brushWorldPosition.y + (Math.random() * 2 - 1) * 20,
            this.brushWorldPosition.z,
        );
        drop.setWorldPosition(start);
        const end = new Vec3(start.x + (Math.random() * 2 - 1) * 30, start.y - this.scrubDropFall * (0.7 + Math.random() * 0.6), start.z);

        const opacity = drop.getComponent(UIOpacity)!;
        Tween.stopAllByTarget(drop);
        Tween.stopAllByTarget(opacity);
        opacity.opacity = 235;
        const d = this.scrubDropDuration;
        const node = drop;
        tween(node)
            .to(d, { worldPosition: end, scale: new Vec3(0.6, 0.6, 1) }, { easing: 'quadIn' })
            .call(() => {
                node.active = false;
                this.scrubDropPool.push(node);
            })
            .start();
        tween(opacity).delay(d * 0.3).to(d * 0.7, { opacity: 0 }).start();
    }

    private isInsideNode(worldPos: Vec3, node: Node): boolean {
        if (!node.isValid || !node.activeInHierarchy) return false;
        const transform = node.getComponent(UITransform);
        if (!transform) return false;
        const local = transform.convertToNodeSpaceAR(worldPos);
        const left = -transform.anchorX * transform.width;
        const bottom = -transform.anchorY * transform.height;
        return local.x >= left && local.x <= left + transform.width && local.y >= bottom && local.y <= bottom + transform.height;
    }

    private hitTarget(state: SoapTargetState): void {
        state.hitCount++;
        this.hasActivatedTargetInCurrentDrag = true;
        if (state.hitCount < Math.max(1, this.hitsToActivate)) return;
        this.activateTarget(state);
    }

    private activateTarget(state: SoapTargetState): void {
        if (state.isActivated) return;
        state.isActivated = true;
        (this.itemCleanManager ?? ItemCleanManager.Ins as ItemCleanManager | null)?.ReportCleanAction(state.node.worldPosition);
        if (this.playCutSound) Ply_SoundManager.Ins?.PlayFx(this.cutFxType);
        state.node.active = true;
        const foamSprite = this.activateSpriteOnly ? this.getFoamSprite(state.node) : null;
        if (foamSprite) {
            this.popIn(foamSprite.node);
        } else {
            const particle = state.node.getComponent(ParticleSystem2D) ?? state.node.getComponentInChildren(ParticleSystem2D);
            if (particle) {
                particle.node.active = true;
                particle.resetSystem();
            } else {
                console.warn(`[SoapAdd] Target "${state.node.name}" has no ParticleSystem2D.`);
            }
        }

        this.onTargetActivated.invoke();
        this.tryComplete();
    }

    /** Sprite bọt (không phải particle) bên dưới một điểm soap. */
    private getFoamSprite(node: Node): Sprite | null {
        return node.getComponentsInChildren(Sprite).find(s => !s.getComponent(ParticleSystem2D)) ?? null;
    }

    private popIn(node: Node): void {
        const scale = node.scale.clone();
        Tween.stopAllByTarget(node);
        node.active = true;
        node.setScale(0, 0, 1);
        tween(node).to(0.25, { scale }, { easing: 'backOut' }).start();
    }

    /** Brush cọ tới bọt dạng sprite: sprite mờ đi, particle bọt bắt đầu sủi. */
    private convertTarget(node: Node, sprite: Sprite): void {
        this.convertedTargets.add(node);
        this.hasActivatedTargetInCurrentDrag = true;
        (this.itemCleanManager ?? ItemCleanManager.Ins as ItemCleanManager | null)?.ReportCleanAction(node.worldPosition);
        if (this.playCutSound) Ply_SoundManager.Ins?.PlayFx(this.cutFxType);

        const particle = node.getComponentInChildren(ParticleSystem2D);
        if (particle) {
            particle.node.active = true;
            particle.resetSystem();
            this.prewarmParticle(particle);
        }
        // Crossfade: particle đã đầy ngay từ đầu nên sprite chỉ mờ dần đè lên, không có khoảng hụt.
        const opacity = sprite.getComponent(UIOpacity) ?? sprite.addComponent(UIOpacity);
        Tween.stopAllByTarget(opacity);
        tween(opacity)
            .to(0.6, { opacity: 0 }, { easing: 'sineInOut' })
            .call(() => { sprite.node.active = false; opacity.opacity = 255; })
            .start();
        this.tryComplete();
    }

    /** Chạy trước particle cho tới khi đủ số hạt, để bọt hiện đầy ngay thay vì sủi từng hạt một. */
    private prewarmParticle(particle: ParticleSystem2D): void {
        const sim = (particle as any)._simulator;
        if (!sim?.step || !particle.emissionRate) return;
        const fillTime = Math.min(particle.life, particle.totalParticles / particle.emissionRate) + 0.05;
        const step = 1 / 30;
        try {
            for (let t = 0; t < fillTime; t += step) sim.step(step);
        } catch (e) {
            console.warn('[SoapAdd] Prewarm particle failed.', e);
        }
    }

    private tryComplete(): void {
        if (this.isDone) return;
        if (!this.targetStates.every(target => target.isActivated)) return;
        const allConverted = this.convertTargets.every(node =>
            !node?.isValid || this.convertedTargets.has(node) || !this.getFoamSprite(node)?.node.activeInHierarchy);
        if (!allConverted) return;
        this.isDone = true;
        this.toggleNodesOnAllDone();
        this.onAllTargetsActivated.invoke();
        (this.itemCleanManager ?? ItemCleanManager.Ins as ItemCleanManager | null)?.ItemCleanDone();
    }

    private toggleNodesOnAllDone(): void {
        const duration = this.toggleFadeDuration;
        for (const node of this.showOnAllDone) {
            if (!node?.isValid) continue;
            const opacity = node.getComponent(UIOpacity) ?? node.addComponent(UIOpacity);
            Tween.stopAllByTarget(opacity);
            node.active = true;
            if (duration <= 0) {
                opacity.opacity = 255;
                continue;
            }
            opacity.opacity = 0;
            tween(opacity).to(duration, { opacity: 255 }, { easing: 'sineOut' }).start();
        }

        for (const node of this.hideOnAllDone) {
            if (!node?.isValid) continue;
            if (duration <= 0) {
                node.active = false;
                continue;
            }
            const opacity = node.getComponent(UIOpacity) ?? node.addComponent(UIOpacity);
            Tween.stopAllByTarget(opacity);
            tween(opacity)
                .to(duration, { opacity: 0 }, { easing: 'sineIn' })
                .call(() => {
                    node.active = false;
                    opacity.opacity = 255;
                })
                .start();
        }
    }

    private startDragSound(isOverTarget = false): void {
        if (!this.playDragSound || (this.dragSoundMode === CleaningSoundMode.TargetOnly && !isOverTarget)
            || this.isDragSoundPlaying || !Ply_SoundManager.Ins) return;
        Ply_SoundManager.Ins.PlayFxLoop(this.dragFxType);
        this.isDragSoundPlaying = true;
    }

    private updateDragSound(isOverTarget: boolean): void {
        if (this.dragSoundMode === CleaningSoundMode.TargetOnly && !isOverTarget) {
            this.stopDragSound();
            return;
        }
        this.startDragSound(isOverTarget);
    }

    private stopDragSound(): void {
        if (!this.isDragSoundPlaying) return;
        Ply_SoundManager.Ins?.StopFxLoop(this.dragFxType);
        this.isDragSoundPlaying = false;
    }

    private startTrailParticle(): void {
        if (!this.trailParticle) return;

        this.trailParticle.node.active = true;
        this.trailParticle.enabled = true;
        this.trailParticle.duration = -1;
        this.trailParticle.autoRemoveOnFinish = false;
        if (this.trailOnlyWhenScrubbing) {
            this.scrubHoldTime = 0;
            this.trailParticle.emissionRate = 0;
        }
        if (this.isTrailPlaying) return;

        this.trailParticle.resetSystem();
        this.isTrailPlaying = true;
    }

    private stopTrailParticle(): void {
        if (!this.trailParticle) return;
        this.trailParticle.stopSystem();
        this.isTrailPlaying = false;
    }

    private isCurrentCleanManagerItem(): boolean {
        const manager = this.itemCleanManager ?? ItemCleanManager.Ins as ItemCleanManager | null;
        if (!manager) return true;
        return this.onProcess
            && manager.currentItemIndex >= 0
            && manager.items[manager.currentItemIndex] === this.node;
    }

    /** Không hiện BreakHeart khi lượt kéo vừa rồi đã soap trúng ít nhất một target. */
    public OnDragFailReturnComplete(): void {
        if (!this.hasActivatedTargetInCurrentDrag) {
            super.OnDragFailReturnComplete();
        }
    }

    public SpawnBreakHeart(): void {
        if (!this.hasActivatedTargetInCurrentDrag) {
            super.SpawnBreakHeart();
        }
    }
}
