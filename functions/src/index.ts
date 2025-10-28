/// <reference lib="dom" />  // fetch 타입 경고 방지

import { onCall, HttpsError } from "firebase-functions/v2/https";

type WeatherBrief = { summary: string; tempC: number; precipitation: string; isOutdoorFriendly: boolean };
type LocationBrief = { city?: string; lat?: number; lon?: number };

export const generateHolidayPlan = onCall(
  { region: "asia-northeast3", secrets: ["OPENAI_API_KEY"] },
  async (req) => {
    if (!req.auth?.uid) throw new HttpsError("unauthenticated", "로그인이 필요합니다");

    const { date, location, weather, prefs } = (req.data ?? {}) as {
      date: string; location: LocationBrief; weather: WeatherBrief; prefs?: string;
    };
    if (!date || !location || !weather)
      throw new HttpsError("invalid-argument", "date/location/weather가 필요합니다");

    const schema = {
      type: "object",
      additionalProperties: false,
      properties: {
        activities: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              title: { type: "string" },
              category: { type: "string" },
              indoorOutdoor: { type: "string", enum: ["indoor","outdoor","either"] },
              durationMin: { type: "integer", minimum: 30, maximum: 300 },
              prepMin: { type: "integer", minimum: 0 },
              placeQuery: { type: "string" },
              notes: { type: "string" },
              budget: { type: "string" },
              openHoursHint: {
                type: "object",
                additionalProperties: false,
                properties: { open: { type: "string" }, close: { type: "string" } }
              }
            },
            required: ["title","category","indoorOutdoor","durationMin"]
          }
        }
      },
      required: ["activities"]
    };

    const system = [
      "너는 한국 사용자의 당일 휴일 활동 아이디어를 만든다.",
      "반드시 JSON만 출력한다(설명문 금지).",
      "식사/수면/고정일정은 이미 있으니 그 사이를 채울 활동만 제안한다.",
      "날씨/실내외 적합성 반영, 장거리 이동은 피한다.",
      "활동당 durationMin(60~120분 위주)을 포함한다."
    ].join("\n");

    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY!}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.6,
        messages: [
          { role: "system", content: system },
          { role: "user", content: JSON.stringify({ date, location, weather, prefs }) }
        ],
        response_format: { type: "json_schema", json_schema: { name: "HolidayPlan", schema } }
      }),
    });

    if (!resp.ok) throw new HttpsError("internal", `OpenAI 오류: ${await resp.text()}`);

    const data = await resp.json();
    const content = data?.choices?.[0]?.message?.content || '{"activities": []}';
    return JSON.parse(content); // { activities: [...] }
  }
);
