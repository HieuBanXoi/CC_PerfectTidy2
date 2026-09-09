import { _decorator, Node, EventHandler } from 'cc';

const { ccclass, property } = _decorator;

/**
 * Extension of native Cocos Creator EventHandler that provides full Dropdown Lists
 * in Inspector for Component & Method selection, plus an extra Node parameter.
 */
@ccclass('Ply_EventCall')
export class Ply_EventCall {

    @property({ type: EventHandler, tooltip: 'Native Cocos EventHandler (Select Component and Method via Dropdown lists)' })
    public eventHandler: EventHandler = new EventHandler();

    @property({ type: Node, tooltip: 'Extra Node parameter passed to the handler method' })
    public nodeParam: Node = null!;

    /**
     * Invoke the method configured in eventHandler, passing nodeParam if assigned
     */
    public invoke(...dynamicArgs: any[]) {
        if (!this.eventHandler) return;

        const targetNode = this.eventHandler.target;
        const compName = this.eventHandler.component;
        const handlerName = this.eventHandler.handler;
        const customData = this.eventHandler.customEventData;

        if (!targetNode || !handlerName) return;

        let targetObj: any = null;
        if (compName) {
            targetObj = targetNode.getComponent(compName);
        }
        if (!targetObj) {
            const comps = targetNode.components;
            if (comps) {
                for (let i = 0; i < comps.length; i++) {
                    const comp = comps[i];
                    if (comp && typeof (comp as any)[handlerName] === 'function') {
                        targetObj = comp;
                        break;
                    }
                }
            }
        }

        if (!targetObj || typeof targetObj[handlerName] !== 'function') {
            console.warn(`[Ply_Event] Handler "${handlerName}" not found on target "${targetNode.name}"!`);
            return;
        }

        // If extra nodeParam is assigned, pass nodeParam first!
        if (this.nodeParam && this.nodeParam.isValid) {
            targetObj[handlerName].call(targetObj, this.nodeParam, customData, ...dynamicArgs);
        } else if (customData !== '') {
            targetObj[handlerName].call(targetObj, customData, ...dynamicArgs);
        } else {
            targetObj[handlerName].apply(targetObj, dynamicArgs);
        }
    }
}

/**
 * Event container holding an array of Ply_EventCall
 */
@ccclass('Ply_Event')
export class Ply_Event {

    // Must be a direct serialized field. Cocos does not reliably preserve a
    // decorated getter/setter inside a nested serializable event class.
    @property({ type: [Ply_EventCall], tooltip: 'List of event calls with dropdown lists and optional Node parameter' })
    public calls: Ply_EventCall[] = [];
    private codeListeners: Array<(...args: any[]) => void> = [];

    /**
     * Invoke all registered listeners
     */
    public invoke(...args: any[]) {
        const list = this.calls;
        if (list && Array.isArray(list)) {
            for (let i = 0; i < list.length; i++) {
                if (list[i]) {
                    list[i].invoke(...args);
                }
            }
        }

        if (this.codeListeners && Array.isArray(this.codeListeners)) {
            for (let i = 0; i < this.codeListeners.length; i++) {
                if (typeof this.codeListeners[i] === 'function') {
                    this.codeListeners[i](...args);
                }
            }
        }
    }

    public addListener(callback: (...args: any[]) => void) {
        if (!this.codeListeners) this.codeListeners = [];
        if (callback && this.codeListeners.indexOf(callback) === -1) {
            this.codeListeners.push(callback);
        }
    }

    public removeListener(callback: (...args: any[]) => void) {
        if (!this.codeListeners) return;
        const index = this.codeListeners.indexOf(callback);
        if (index !== -1) {
            this.codeListeners.splice(index, 1);
        }
    }

    public removeAllListeners() {
        this.codeListeners = [];
    }
}
