import { _decorator, Component, Node, input, Input, EventTouch } from 'cc';
import { PREVIEW } from 'cc/env';
import { Ply_Singleton } from '../Framework/Ply_Singleton';
import { World } from '../../Core/Managers/World';
import { IGameState } from './StateMachine/IGameState';
import { OnPlayState } from './StateMachine/OnPlayState';
import { WinState } from './StateMachine/WinState';
import { LoseState } from './StateMachine/LoseState';
import { StopGameState } from './StateMachine/StopGameState';
import { GameController } from '../../Platform/GameController';
import { AppLovinAnalytics } from '../../Platform/AppLovinAnalytics';

const { ccclass, property } = _decorator;

@ccclass('GameManager')
export class GameManager extends Ply_Singleton<GameManager> {

    @property
    public isPlaying: boolean = false;

    @property
    public isTutorial: boolean = true;

    @property
    public isGotoStore: boolean = false;

    @property
    public isLoseGame: boolean = false;

    @property
    public countMove: number = 0;

    @property({ tooltip: 'Show a browser confirmation dialog before redirecting to the store in Web Preview only.' })
    public showStoreDialogInWebPreview = true;

    @property({ tooltip: 'Message displayed by the Web Preview store dialog.' })
    public storeDialogMessage = 'Open the store?';

    @property
    public currentLayer: number = 0;

    private currentState: IGameState | null = null;
    private preventNativeTouch: ((event: TouchEvent) => void) | null = null;
    private isFirstTouch: boolean = true;

    protected onLoad() {
        super.onLoad();
        input.on(Input.EventType.TOUCH_START, this.onTouchStart, this);
        this.disableBrowserTouchGestures();
        AppLovinAnalytics.startLoading();
    }

    protected start() {
        AppLovinAnalytics.loaded();
        AppLovinAnalytics.displayed();
        this.ChangeState(new OnPlayState());
    }

    protected update(dt: number) {
        if (this.currentState) {
            this.currentState.OnExecute(this);
        }
    }

    protected onDestroy() {
        input.off(Input.EventType.TOUCH_START, this.onTouchStart, this);

        if (this.preventNativeTouch && typeof document !== 'undefined') {
            const canvas = document.getElementById('GameCanvas');
            canvas?.removeEventListener('touchmove', this.preventNativeTouch);
        }
    }

    private onTouchStart(event: EventTouch) {
        if (this.isFirstTouch) {
            this.isFirstTouch = false;
            AppLovinAnalytics.challengeStarted();
        }

        if (this.isGotoStore) {
            this.GotoStore();
        }
    }

    /** Prevent the mobile browser from turning a drag into a page gesture. */
    private disableBrowserTouchGestures() {
        if (typeof document === 'undefined') return;

        const canvas = document.getElementById('GameCanvas');
        if (!canvas) return;

        canvas.style.touchAction = 'none';
        this.preventNativeTouch = (event: TouchEvent) => event.preventDefault();
        canvas.addEventListener('touchmove', this.preventNativeTouch, { passive: false });
    }

    public ChangeState(newState: IGameState) {
        if (this.currentState) {
            this.currentState.OnExit(this);
        }

        this.currentState = newState;

        if (this.currentState) {
            this.currentState.OnEnter(this);
        }
        console.log(`GameManager: Changed state to ${newState.constructor.name}`);
    }

    public IsPlaying(): boolean {
        return this.isPlaying;
    }

    public SetIsPlaying(isPlaying: boolean) {
        this.isPlaying = isPlaying;
    }

    /**
     * Redirect to store (Left empty for user to implement)
     */
    public GotoStore() {
        // PREVIEW is true only for Cocos Editor's browser preview. A built
        // web/native game bypasses this dialog and redirects immediately.
        if (PREVIEW && this.showStoreDialogInWebPreview && typeof window !== 'undefined') {
            const shouldOpenStore = window.confirm(this.storeDialogMessage);
            if (!shouldOpenStore) return;
        }
        AppLovinAnalytics.ctaClicked();
        GameController.redirectToStore();
    }

    public MoveOne() {
        this.countMove++;
        if (this.countMove === 100) {
            this.isPlaying = false;
            this.isGotoStore = true;
        }
    }

    public TurnOffTut() {
        if (this.isTutorial) {
            World.instance?.ui?.offHand();
            this.isTutorial = false;
        }
    }

    /** Stops gameplay; the next screen touch redirects to the store. */
    public StopGame() {
        this.ChangeState(new StopGameState());
    }

    public WinGame() {
        console.log("GameManager: WinGame called");
        this.isLoseGame = false;
        this.isPlaying = false;
        this.ChangeState(new WinState());
    }

    public LoseGame() {
        console.log("GameManager: LoseGame called");
        this.isLoseGame = true;
        this.isPlaying = false;
        this.ChangeState(new LoseState());
    }

    public OnItemPlaced(item?: any) {
        this.TurnOffTut();
    }

    public ResetInactivityTimer(item?: any) {
        // Reserved for tutorial / inactivity timeout logic
    }

    public AddItemToTutorial(item?: any) {
        // Reserved for tutorial tracking
    }

    public RemoveItemFromTutorial(item?: any) {
        // Reserved for tutorial tracking
    }
    public Applovin25(){
        AppLovinAnalytics.challenge25();
    }
    public Applovin50(){
        AppLovinAnalytics.challenge50();
    }
    public Applovin75(){
        AppLovinAnalytics.challenge75();
    }
}
