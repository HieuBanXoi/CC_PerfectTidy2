import { GameManager } from '../GameManager';
import { HandTutManager } from '../HandTutManager';
import { IGameState } from './IGameState';

/** Stops gameplay, keeps the tutorial visual running, then redirects the next touch. */
export class StopGameState implements IGameState {
    public OnEnter(gameManager: GameManager): void {
        gameManager.isPlaying = false;
        gameManager.isLoseGame = false;
        gameManager.isGotoStore = true;

        // Hand tutorial is visual-only here; it is not gated by isPlaying.
        HandTutManager.Ins?.StartHandTut();
    }

    public OnExecute(_gameManager: GameManager): void {
    }

    public OnExit(_gameManager: GameManager): void {
    }
}
