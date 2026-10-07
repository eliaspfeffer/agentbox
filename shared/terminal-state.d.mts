export function commandRunning(processName: string, exited: boolean): boolean;
export function whenACommandFinishes(onFinish: () => void): (processName: string, exited: boolean) => void;
