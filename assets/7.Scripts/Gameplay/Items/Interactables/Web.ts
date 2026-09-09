import { _decorator, Node, ParticleSystem2D, Tween, tween, UITransform, Vec3 } from 'cc';
import { Item } from '../Components/Item';

const { ccclass, property } = _decorator;

/** A cleanable web that gradually disappears as the cleaner moves across it. */
@ccclass('Web')
export class Web extends Item {
    @property({ type: Node, tooltip: 'Visual model that shrinks while the web is swept. The Web root is not scaled.' })
    public model: Node | null = null;

    @property({ type: ParticleSystem2D, tooltip: 'Debris particle played only while this web is being swept.' })
    public webDebris: ParticleSystem2D | null = null;

    @property({ min: 0.001, tooltip: 'Minimum cleaner movement required before the web shrinks again.' })
    public minimumMovementDistance = 2;

    @property({ min: 0.001, max: 1, tooltip: 'Fraction of the original scale removed for each valid cleaner movement.' })
    public shrinkPerMove = 0.04;

    @property({ min: 0.01, max: 1, tooltip: 'Fraction swept before this web is considered complete.' })
    public completeThreshold = 0.9;

    @property({ min: 0, tooltip: 'Maximum local-position offset used for the small shake after shrinking.' })
    public shrinkShakeDistance = 5;

    @property({ min: 0.01, tooltip: 'Duration of the shrink shake in seconds.' })
    public shrinkShakeDuration = 0.08;

    @property({ readonly: true, tooltip: 'True after this web has been fully swept away.' })
    public isCleaned = false;

    private initialModelScale = new Vec3(1, 1, 1);
    private initialModelPosition = new Vec3();
    private remainingScale = 1;
    private isDebrisPlaying = false;
    private modelShakeTween: Tween<Node> | null = null;

    protected onLoad(): void {
        super.onLoad();
        this.model ??= this.node.children.find(child => child.getComponent(ParticleSystem2D) === null) ?? null;
        if (this.model) {
            Vec3.copy(this.initialModelScale, this.model.scale);
            Vec3.copy(this.initialModelPosition, this.model.position);
        } else {
            console.warn(`[Web] Assign a model node on "${this.node.name}" so only its visual is scaled.`);
        }
        this.webDebris ??= this.getComponentInChildren(ParticleSystem2D);
        this.StopDebris();
    }

    public IsPointInsideWeb(worldPosition: Vec3, padding = 0): boolean {
        const transform = this.getComponent(UITransform) || this.getComponentInChildren(UITransform);
        if (!transform) return false;

        const localPoint = transform.convertToNodeSpaceAR(worldPosition);
        const left = -transform.anchorX * transform.width - padding;
        const right = left + transform.width + padding * 2;
        const bottom = -transform.anchorY * transform.height - padding;
        const top = bottom + transform.height + padding * 2;
        return localPoint.x >= left && localPoint.x <= right && localPoint.y >= bottom && localPoint.y <= top;
    }

    /** Called by WebCleaner only after its brush has moved inside this web. */
    public Sweep(movementDistance: number): void {
        if (this.isCleaned || movementDistance < this.minimumMovementDistance) return;

        this.PlayDebris();
        this.remainingScale = Math.max(0, this.remainingScale - this.shrinkPerMove);
        this.model?.setScale(
            this.initialModelScale.x * this.remainingScale,
            this.initialModelScale.y * this.remainingScale,
            this.initialModelScale.z,
        );
        this.PlayShrinkShake();

        if (1 - this.remainingScale >= this.completeThreshold) {
            this.CompleteCleaning();
        }
    }

    public PlayDebris(): void {
        if (!this.webDebris || this.isCleaned || this.isDebrisPlaying) return;
        this.webDebris.resetSystem();
        this.isDebrisPlaying = true;
    }

    public StopDebris(): void {
        this.webDebris?.stopSystem();
        this.isDebrisPlaying = false;
    }

    public ResetWeb(): void {
        this.isCleaned = false;
        this.remainingScale = 1;
        this.model?.setScale(this.initialModelScale);
        this.StopShrinkShake();
        this.StopDebris();
    }

    private CompleteCleaning(): void {
        if (this.isCleaned) return;
        this.isCleaned = true;
        this.StopShrinkShake();
        this.model?.setScale(0, 0, this.initialModelScale.z);
        this.StopDebris();
    }

    private PlayShrinkShake(): void {
        const model = this.model;
        const distance = Math.max(0, this.shrinkShakeDistance);
        if (!model || distance <= 0) return;

        this.modelShakeTween?.stop();
        const direction = Math.random() < 0.5 ? -1 : 1;
        const offset = new Vec3(
            this.initialModelPosition.x + distance * direction,
            this.initialModelPosition.y,
            this.initialModelPosition.z,
        );
        const halfDuration = Math.max(0.01, this.shrinkShakeDuration * 0.5);
        this.modelShakeTween = tween(model)
            .set({ position: this.initialModelPosition })
            .to(halfDuration, { position: offset })
            .to(halfDuration, { position: this.initialModelPosition })
            .call(() => this.modelShakeTween = null)
            .start();
    }

    private StopShrinkShake(): void {
        this.modelShakeTween?.stop();
        this.modelShakeTween = null;
        this.model?.setPosition(this.initialModelPosition);
    }
}
