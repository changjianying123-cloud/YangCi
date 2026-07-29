import { Response } from 'express';

export function ok<T>(res: Response, data?: T, msg = 'success') {
  return res.json({ code: 200, msg, data });
}

export function fail(res: Response, code: number, msg: string) {
  return res.status(code >= 400 ? code : 400).json({ code, msg });
}
