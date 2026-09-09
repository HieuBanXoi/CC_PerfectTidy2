import { GameManager } from '../GameManager';

export interface IGameState {
    OnEnter(gameManager: GameManager): void;
    OnExecute(gameManager: GameManager): void;
    OnExit(gameManager: GameManager): void;
}
