import { _decorator, animation, Animation, AnimationState, Node, Sprite, SpriteFrame, Vec2, Vec3, EventTouch } from 'cc';
import { Ply_SoundManager, FxType } from '../../Framework/Ply_SoundManager';
import { Ply_Event } from '../../Framework/Ply_Event';
import { Ply_EventHandlerComponent } from '../../Framework/Ply_EventHandlerComponent';
import { GameManager } from '../../Systems/GameManager';

const { ccclass, property } = _decorator;

@ccclass('ItemStirring')
export class ItemStirring extends Ply_EventHandlerComponent {

    @property
    public stirRadius: number = 200;

    @property(Node)
    public stirrerTransform: Node = null!;

    @property(Node)
    public centerPoint: Node = null!;

    @property({ type: Sprite, tooltip: 'Sprite whose appearance changes while stirring. If empty, the first Sprite on this node is used.' })
    public stateSprite: Sprite | null = null;

    @property({ type: SpriteFrame, tooltip: 'Sprite shown while the player is stirring.' })
    public stirringSpriteFrame: SpriteFrame | null = null;

    @property({ type: SpriteFrame, tooltip: 'Sprite shown before stirring and after stirring completes.' })
    public idleSpriteFrame: SpriteFrame | null = null;

    @property({ type: Animation, tooltip: 'Animation used as stirring progress. If empty, the Animation on stirrerTransform is used.' })
    public stirAnimation: Animation | null = null;

    @property({ tooltip: 'Clip to play. Leave empty to use the first clip on Stir Animation.' })
    public stirAnimationClipName: string = '';

    @property({ type: animation.AnimationController, tooltip: 'Optional Animation Controller used instead of Stir Animation.' })
    public stirAnimationController: animation.AnimationController | null = null;

    @property({ tooltip: 'Trigger set on Stir Animation Controller when stirring begins.' })
    public stirControllerTrigger: string = '';

    @property({ min: 0.01, tooltip: 'Slowest speed while the player is holding the stirring interaction.' })
    public minAnimationSpeed: number = 0.1;

    @property({ min: 0.01, tooltip: 'Fastest allowed stirring animation speed.' })
    public maxAnimationSpeed: number = 1;

    @property({ min: 0.0001, tooltip: 'Touch movement in pixels converted to animation speed.' })
    public dragToAnimationSpeed: number = 0.05;

    @property({ type: Ply_Event, tooltip: 'On stir begin event' })
    public onStirBegin: Ply_Event = new Ply_Event();

    @property({ type: Ply_Event, tooltip: 'On stir complete event' })
    public onStirComplete: Ply_Event = new Ply_Event();

    private isDone: boolean = false;
    private isStirring: boolean = false;
    private currentProgress: number = 0;
    private lastTouchPos: Vec2 = new Vec2();
    private stirAnimationState: AnimationState | null = null;

    public get IsDone(): boolean {
        return this.isDone;
    }

    public get IsStirring(): boolean {
        return this.isStirring;
    }

    protected onLoad(): void {
        this.ShowIdleSprite();
    }

    public BeginStir(event?: EventTouch) {
        if (!GameManager.Ins?.IsPlaying() || this.isDone || !this.enabled) return;
        this.isStirring = true;
        this.ShowStirringSprite();

        if (event) {
            const touchPos = event.getUILocation();
            this.lastTouchPos.set(touchPos.x, touchPos.y);
        }

        if (this.stirrerTransform) this.stirrerTransform.active = true;

        if (this.UsesAnimationController()) {
            this.stirAnimationController!.setValue(this.stirControllerTrigger.trim(), true);
        } else {
            this.resumeStirAnimation();
        }

        this.onStirBegin.invoke();
    }

    public ResetStir() {
        this.isDone = false;
        this.isStirring = false;
        this.currentProgress = 0;
        this.ShowIdleSprite();
        if (this.UsesAnimationController()) return;

        const state = this.getStirAnimationState();
        if (state) {
            state.pause();
            state.setTime(0);
            state.sample();
        }
    }

    public Stir(event: EventTouch) {
        if (!this.isStirring || this.isDone || !this.enabled) return;

        const curTouchPos = event.getUILocation();
        const dist = Vec2.distance(this.lastTouchPos, curTouchPos);
        this.lastTouchPos.set(curTouchPos.x, curTouchPos.y);

        this.moveStirrerToTouch(curTouchPos);

        // A controller owns the animation timing. Touch movement still moves
        // the visual stirrer, but it does not attempt to alter clip speed.
        if (this.UsesAnimationController()) return;

        const state = this.getStirAnimationState();
        if (!state) return;

        state.speed = Math.min(this.maxAnimationSpeed, Math.max(this.minAnimationSpeed, dist * this.dragToAnimationSpeed));
        if (state.isPaused) state.resume();
    }

    public EndStir() {
        if (this.isDone) return;
        this.isStirring = false;
        if (!this.UsesAnimationController()) this.stirAnimationState?.pause();
    }

    protected update(): void {
        if (!this.isStirring || this.isDone) return;

        // Animation controllers do not expose a generic clip progress API.
        // Add an Animation Event on the controller's stir clip that calls
        // CompleteStir() on this component.
        if (this.UsesAnimationController()) return;

        const state = this.getStirAnimationState();
        if (!state || state.duration <= 0) return;

        this.currentProgress = Math.min(1, Math.max(0, state.time / state.duration));

        if (this.currentProgress >= 0.999) {
            this.CompleteStir();
        }
    }

    /**
     * Finishes stirring. For an Animation Controller, call this from an
     * Animation Event at the end of the controller's stirring clip.
     */
    public CompleteStir() {
        if (this.isDone) return;
        this.isDone = true;
        this.isStirring = false;
        this.ShowIdleSprite();
        if (this.stirAnimationState) {
            this.stirAnimationState.setTime(this.stirAnimationState.duration);
            this.stirAnimationState.sample();
            this.stirAnimationState.pause();
        }
        this.onStirComplete.invoke();
    }

    private resumeStirAnimation(): void {
        const state = this.getStirAnimationState();
        if (!state) {
            console.warn(`[ItemStirring] No Animation/clip is configured on "${this.node.name}".`);
            return;
        }

        if (state.time >= state.duration - 0.001) {
            state.setTime(0);
        }

        state.repeatCount = 1;
        state.speed = this.minAnimationSpeed;
        if (state.isPaused) {
            state.resume();
        } else if (!state.isPlaying) {
            this.stirAnimation?.play(state.name);
        }
    }

    private UsesAnimationController(): boolean {
        return !!this.stirAnimationController && !!this.stirControllerTrigger.trim();
    }

    /** Changes to the visual used while the spatula is at the stirring target. */
    public ShowStirringSprite(): void {
        this.applyStateSprite(this.stirringSpriteFrame);
    }

    /** Restores the visual used before stirring and after it completes. */
    public ShowIdleSprite(): void {
        this.applyStateSprite(this.idleSpriteFrame);
    }

    private applyStateSprite(spriteFrame: SpriteFrame | null): void {
        if (!spriteFrame) return;

        if (!this.stateSprite) {
            this.stateSprite = this.getComponent(Sprite) || this.getComponentInChildren(Sprite);
        }

        if (this.stateSprite) this.stateSprite.spriteFrame = spriteFrame;
    }

    private getStirAnimationState(): AnimationState | null {
        if (this.stirAnimationState) return this.stirAnimationState;

        if (!this.stirAnimation && this.stirrerTransform) {
            this.stirAnimation = this.stirrerTransform.getComponent(Animation)
                || this.stirrerTransform.getComponentInChildren(Animation);
        }

        const animation = this.stirAnimation;
        if (!animation) return null;

        const clipName = this.stirAnimationClipName || animation.clips[0]?.name;
        if (!clipName) return null;

        this.stirAnimationState = animation.getState(clipName);
        return this.stirAnimationState;
    }

    /** Moves the stirrer to the touch position, constrained to stirRadius around centerPoint. */
    private moveStirrerToTouch(touchPosition: Vec2): void {
        if (!this.stirrerTransform) return;

        const center = (this.centerPoint ?? this.node).worldPosition;
        const stirrerZ = this.stirrerTransform.worldPosition.z;
        const offset = new Vec3(touchPosition.x - center.x, touchPosition.y - center.y, 0);

        const radius = Math.max(0, this.stirRadius);
        const distance = Math.hypot(offset.x, offset.y);
        if (distance > radius && distance > 0) {
            const scale = radius / distance;
            offset.multiplyScalar(scale);
        }

        this.stirrerTransform.setWorldPosition(center.x + offset.x, center.y + offset.y, stirrerZ);
    }
}
