import { IGameState } from './IGameState';
import { GameManager } from '../GameManager';
import { World } from '../../../Core/Managers/World';
import { AppLovinAnalytics } from '../../../Platform/AppLovinAnalytics';

export class LoseState implements IGameState {
    public OnEnter(gameManager: GameManager): void {
        AppLovinAnalytics.endcardShown();
        AppLovinAnalytics.challengeFailed();
        World.instance?.ui?.onLose();
        gameManager.isGotoStore = true;
        gameManager.isPlaying = false;
    }

    public OnExecute(gameManager: GameManager): void {
    }

    public OnExit(gameManager: GameManager): void {
    }
}
