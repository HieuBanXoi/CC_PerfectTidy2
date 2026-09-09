import { IGameState } from './IGameState';
import { GameManager } from '../GameManager';

export class OnPlayState implements IGameState {
    public OnEnter(gameManager: GameManager): void {
        gameManager.isPlaying = true;
        gameManager.isGotoStore = false;
    }

    public OnExecute(gameManager: GameManager): void {
    }

    public OnExit(gameManager: GameManager): void {
        gameManager.isPlaying = false;
        gameManager.isGotoStore = true;
    }
}
