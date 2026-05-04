declare module "@inquirer/prompts" {
  export type PromptValidate<T> = (value: T) => true | string | Promise<true | string>;

  export function input(opts: {
    message: string;
    default?: string;
    validate?: PromptValidate<string>;
  }): Promise<string>;

  export function confirm(opts: {
    message: string;
    default?: boolean;
  }): Promise<boolean>;

  export function select<T>(opts: {
    message: string;
    choices: Array<{ name: string; value: T }>;
  }): Promise<T>;
}

