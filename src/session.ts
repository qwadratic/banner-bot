export type Session = {
  userId: number;
  phase: string;
  startedAt: Date;
};

export type GlobalState = {
  activeSession: Session | null;
  devUserMode: boolean;
};

export const globalState: GlobalState = {
  activeSession: null,
  devUserMode: false,
};
