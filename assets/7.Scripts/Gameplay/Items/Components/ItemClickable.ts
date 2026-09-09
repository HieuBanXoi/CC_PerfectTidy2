import { _decorator } from 'cc';
import { Ply_SoundManager, FxType } from '../../Framework/Ply_SoundManager';
import { Ply_Event } from '../../Framework/Ply_Event';
import { Ply_EventHandlerComponent } from '../../Framework/Ply_EventHandlerComponent';

const { ccclass, property } = _decorator;

@ccclass('ItemClickable')
export class ItemClickable extends Ply_EventHandlerComponent {

    @property
    public requiredClicks: number = 1;

    @property
    public infiniteClick: boolean = false;

    @property
    public canClick: boolean = true;

    @property({ tooltip: 'Disable clicking after click until EnableClick() is called' })
    public disableAfterClick: boolean = false;

    @property({ type: Ply_Event, tooltip: 'General onClick event' })
    public onClick: Ply_Event = new Ply_Event();

    @property({ type: Ply_Event, tooltip: 'Called when click count reaches requiredClicks' })
    public onClickComplete: Ply_Event = new Ply_Event();

    private currentClicks: number = 0;

    public PerformClick() {
        if (!this.canClick) return;

        if (this.disableAfterClick) {
            this.canClick = false;
        }

        this.currentClicks++;

        this.onClick.invoke();

        if (this.infiniteClick) return;

        if (this.currentClicks >= this.requiredClicks) {
            this.onClickComplete.invoke();
            this.currentClicks = 0;
        }
    }

    public CanClick(canClick: boolean) {
        this.canClick = canClick;
    }

    public EnableClick() {
        this.canClick = true;
    }

    public PlayPopSound() {
        Ply_SoundManager.Ins.PlayFx(FxType.Click);
    }
}
