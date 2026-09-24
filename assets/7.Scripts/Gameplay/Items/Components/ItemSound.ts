import { _decorator } from 'cc';
import { Ply_SoundManager, FxType } from '../../Framework/Ply_SoundManager';
import { Ply_EventHandlerComponent } from '../../Framework/Ply_EventHandlerComponent';

const { ccclass } = _decorator;

@ccclass('ItemSound')
export class ItemSound extends Ply_EventHandlerComponent {

    public PlaySoundFX(fxType: FxType) {
        Ply_SoundManager.Ins.PlayFx(fxType);
    }
    public PlayAhaSound() {
        Ply_SoundManager.Ins.PlayFx(FxType.Aha);
    }
}
