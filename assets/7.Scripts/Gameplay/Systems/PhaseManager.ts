import { _decorator, Enum, Node, Tween, tween, Vec3 } from 'cc';
import { GameManager } from './GameManager';
import { HandTutManager } from './HandTutManager';
import { Ply_Event } from '../Framework/Ply_Event';
import { Ply_Singleton } from '../Framework/Ply_Singleton';
import { FxType, Ply_SoundManager } from '../Framework/Ply_SoundManager';

const { ccclass, property } = _decorator;

export enum PhaseTransitionType {
    HorizontalSlide = 0,
    VerticalSlide,
    ObjectTransition,
}
Enum(PhaseTransitionType);

/** Inspector data for one playable phase. */
@ccclass('PhaseData')
export class PhaseData {
    @property({ type: Node, tooltip: 'Root node containing all objects of this phase.' })
    public phaseObject: Node | null = null;

    @property({ min: 0, tooltip: 'Number of successful steps required to finish this phase.' })
    public totalSteps = 1;

    @property({ type: Ply_Event, tooltip: 'Called after this phase reaches the centre and is playable.' })
    public onPhaseReady: Ply_Event = new Ply_Event();
}

/**
 * Controls a sequence of gameplay phases. Call DoOneStep() from each action
 * that counts toward the current phase; the manager moves on automatically
 * after that phase's configured number of steps.
 */
@ccclass('PhaseManager')
export class PhaseManager extends Ply_Singleton<PhaseManager> {
    @property({ type: [PhaseData], tooltip: 'Phases played in order.' })
    public phases: PhaseData[] = [];

    @property({ type: Enum(PhaseTransitionType) })
    public transitionType: PhaseTransitionType = PhaseTransitionType.HorizontalSlide;

    @property({ min: 0.01, tooltip: 'Duration of the incoming/outgoing slide.' })
    public transitionDuration = 1;

    @property({ min: 0, tooltip: 'Delay after completing a phase before its transition starts.' })
    public delayBeforeNextPhase = 2;

    @property public offScreenLeftX = -1500;
    @property public offScreenRightX = 1500;
    @property public offScreenBottomY = -1000;
    @property({ type: Node, tooltip: 'Overlay shown for Object Transition.' })
    public phaseTransitionObject: Node | null = null;

    @property({ min: 0.01, tooltip: 'How long the Object Transition overlay is visible.' })
    public phaseTransitionObjectDuration = 1.5;

    @property({ readonly: true })
    public currentPhaseIndex = 0;

    @property({ readonly: true })
    public currentStepCount = 0;

    /** Local centre position captured from the first active phase. */
    private centerScreenPosition = new Vec3();
    private isChangingPhase = false;
    private delayTween: Tween<Node> | null = null;
    private outgoingTween: Tween<Node> | null = null;
    private incomingTween: Tween<Node> | null = null;
    private transitionTween: Tween<Node> | null = null;

    public get CurrentPhaseObject(): Node | null {
        return this.phases[this.currentPhaseIndex]?.phaseObject ?? null;
    }

    protected onLoad(): void {
        super.onLoad();
        this.setupInitialPhase();
    }

    protected onDisable(): void {
        this.stopTransitionTweens();
    }

    protected onDestroy(): void {
        this.stopTransitionTweens();
        super.onDestroy();
    }

    /** Registers one completed gameplay action. Returns true when a phase ends. */
    public DoOneStep(): boolean {
        if (this.isChangingPhase || !this.hasCurrentPhase()) return false;

        this.currentStepCount++;
        if (!this.IsCurrentPhaseStepComplete()) return false;

        return this.TryEndCurrentPhase();
    }

    public IsCurrentPhaseStepComplete(): boolean {
        const phase = this.phases[this.currentPhaseIndex];
        return !!phase && this.currentStepCount >= Math.max(0, phase.totalSteps);
    }

    /** Starts the configured transition only if the current phase has all its steps. */
    public TryEndCurrentPhase(): boolean {
        if (this.isChangingPhase || !this.IsCurrentPhaseStepComplete()) return false;

        this.isChangingPhase = true;
        GameManager.Ins?.SetIsPlaying(false);
        HandTutManager.Ins?.PauseHandTut();
        Ply_SoundManager.Ins?.PlayFx(FxType.Complete);

        this.stopTransitionTweens();
        this.delayTween = tween(this.node)
            .delay(this.delayBeforeNextPhase)
            .call(() => this.beginPhaseTransition())
            .start();
        return true;
    }

    private setupInitialPhase(): void {
        if (this.phases.length === 0) return;

        this.currentPhaseIndex = Math.max(0, Math.min(this.currentPhaseIndex, this.phases.length - 1));
        for (let index = 0; index < this.phases.length; index++) {
            const phaseNode = this.phases[index]?.phaseObject;
            if (!phaseNode) continue;

            const isCurrent = index === this.currentPhaseIndex;
            phaseNode.active = isCurrent;
            if (!isCurrent) continue;

            Vec3.copy(this.centerScreenPosition, phaseNode.position);
            this.phases[index].onPhaseReady.invoke();
        }

        if (this.phaseTransitionObject) this.phaseTransitionObject.active = false;
    }

    private beginPhaseTransition(): void {
        this.delayTween = null;
        if (!this.hasNextPhase()) {
            this.finishGameByPhase();
            return;
        }

        if (this.transitionType === PhaseTransitionType.ObjectTransition && this.phaseTransitionObject) {
            this.playObjectTransition();
            return;
        }

        this.slideToNextPhase();
    }

    private slideToNextPhase(): void {
        const oldPhase = this.CurrentPhaseObject;
        const newIndex = this.currentPhaseIndex + 1;
        const newPhase = this.phases[newIndex];
        const newNode = newPhase?.phaseObject ?? null;
        const duration = Math.max(0.01, this.transitionDuration);

        this.currentPhaseIndex = newIndex;
        this.currentStepCount = 0;

        if (oldPhase) {
            const oldTarget = this.transitionType === PhaseTransitionType.VerticalSlide
                ? new Vec3(this.centerScreenPosition.x, this.centerScreenPosition.y + this.offScreenBottomY, oldPhase.position.z)
                : new Vec3(this.centerScreenPosition.x + this.offScreenLeftX, this.centerScreenPosition.y, oldPhase.position.z);
            this.outgoingTween = tween(oldPhase)
                .to(duration, { position: oldTarget }, { easing: 'quadInOut' })
                .call(() => oldPhase.active = false)
                .start();
        }

        if (!newNode) {
            this.completeTransition();
            return;
        }

        const startPosition = this.transitionType === PhaseTransitionType.VerticalSlide
            ? new Vec3(this.centerScreenPosition.x, this.centerScreenPosition.y + this.offScreenBottomY, newNode.position.z)
            : new Vec3(this.centerScreenPosition.x + this.offScreenRightX, this.centerScreenPosition.y, newNode.position.z);
        const targetPosition = new Vec3(this.centerScreenPosition.x, this.centerScreenPosition.y, newNode.position.z);
        newNode.active = true;
        newNode.setPosition(startPosition);
        this.incomingTween = tween(newNode)
            .to(duration, { position: targetPosition }, { easing: 'quadInOut' })
            .call(() => this.completeTransition())
            .start();
    }

    private playObjectTransition(): void {
        const overlay = this.phaseTransitionObject!;
        overlay.active = true;
        const halfDuration = Math.max(0.01, this.phaseTransitionObjectDuration) * 0.5;
        this.transitionTween = tween(overlay)
            .delay(halfDuration)
            .call(() => this.switchPhaseImmediately())
            .delay(halfDuration)
            .call(() => {
                overlay.active = false;
                this.completeTransition();
            })
            .start();
    }

    private switchPhaseImmediately(): void {
        const oldNode = this.CurrentPhaseObject;
        this.currentPhaseIndex++;
        this.currentStepCount = 0;
        if (oldNode) oldNode.active = false;

        const newPhase = this.phases[this.currentPhaseIndex];
        const newNode = newPhase?.phaseObject;
        if (newNode) {
            newNode.setPosition(this.centerScreenPosition);
            newNode.active = true;
        }
    }

    private completeTransition(): void {
        this.isChangingPhase = false;
        this.outgoingTween = null;
        this.incomingTween = null;
        this.transitionTween = null;

        const phase = this.phases[this.currentPhaseIndex];
        phase?.onPhaseReady.invoke();
        if (!GameManager.Ins?.isLoseGame) GameManager.Ins?.SetIsPlaying(true);
        HandTutManager.Ins?.StartHandTutNoDelay();
    }

    private finishGameByPhase(): void {
        this.isChangingPhase = false;
        this.currentStepCount = 0;
        GameManager.Ins?.WinGame();
    }

    private hasCurrentPhase(): boolean {
        return this.currentPhaseIndex >= 0 && this.currentPhaseIndex < this.phases.length;
    }

    private hasNextPhase(): boolean {
        return this.currentPhaseIndex + 1 < this.phases.length;
    }

    private stopTransitionTweens(): void {
        this.delayTween?.stop();
        this.outgoingTween?.stop();
        this.incomingTween?.stop();
        this.transitionTween?.stop();
        this.delayTween = null;
        this.outgoingTween = null;
        this.incomingTween = null;
        this.transitionTween = null;
    }
}
