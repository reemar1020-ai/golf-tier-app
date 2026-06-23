"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

type Member = {
  id: string;
  name: string;
  created_at: string;
};

type Round = {
  id: string;
  member_id: string;
  played_at: string;
  course_name: string;
  score: number;
  created_at: string;
};

type MemberStats = {
  member: Member;
  roundsCount: number;
  averageScore: number | null;
  bestScore: number | null;
  recentAverage: number | null;
  rating: number;
  tier: string;
  rounds: Round[];
};

const defaultPlayedAt = new Date().toISOString().slice(0, 10);

function formatDate(value: string | null | undefined) {
  if (!value) return "-";
  return new Date(value).toLocaleDateString("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function getTier(averageScore: number | null) {
  if (averageScore === null) return "D";
  if (averageScore < 80) return "S";
  if (averageScore <= 89) return "A";
  if (averageScore <= 99) return "B";
  if (averageScore <= 109) return "C";
  return "D";
}

function calculateRating(averageScore: number | null) {
  if (averageScore === null) return 0;
  return clamp(Math.round(130 - averageScore), 0, 100);
}

function buildTeamGroups(stats: MemberStats[]) {
  const sorted = [...stats].sort((a, b) => {
    if (a.averageScore === null) return 1;
    if (b.averageScore === null) return -1;
    return a.averageScore - b.averageScore;
  });

  const teams = { teamA: [] as MemberStats[], teamB: [] as MemberStats[] };
  const totals = { teamA: 0, teamB: 0 };

  for (const stat of sorted) {
    if (teams.teamA.length === 5) {
      teams.teamB.push(stat);
      totals.teamB += stat.rating;
    } else if (teams.teamB.length === 5) {
      teams.teamA.push(stat);
      totals.teamA += stat.rating;
    } else if (totals.teamA <= totals.teamB) {
      teams.teamA.push(stat);
      totals.teamA += stat.rating;
    } else {
      teams.teamB.push(stat);
      totals.teamB += stat.rating;
    }
  }

  return { ...teams, totals };
}

export default function Home() {
  const [members, setMembers] = useState<Member[]>([]);
  const [rounds, setRounds] = useState<Round[]>([]);
  const [settings, setSettings] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(false);
  const [newMemberName, setNewMemberName] = useState("");
  const [newRound, setNewRound] = useState({
    memberId: "",
    playedAt: defaultPlayedAt,
    courseName: "",
    score: "",
  });
  const [teamsVisible, setTeamsVisible] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const stats = useMemo(() => {
    return members.map((member) => {
      const memberRounds = rounds
        .filter((round) => round.member_id === member.id)
        .sort((a, b) => new Date(b.played_at).getTime() - new Date(a.played_at).getTime());

      const scores = memberRounds.map((round) => round.score);
      const roundsCount = memberRounds.length;
      const averageScore =
        scores.length > 0
          ? Number(
              (
                scores.reduce((sum, score) => sum + score, 0) / scores.length
              ).toFixed(1)
            )
          : null;
      const bestScore = scores.length > 0 ? Math.min(...scores) : null;
      const recentScores = memberRounds.slice(0, 5).map((round) => round.score);
      const recentAverage =
        recentScores.length > 0
          ? Number(
              (
                recentScores.reduce((sum, score) => sum + score, 0) /
                recentScores.length
              ).toFixed(1)
            )
          : null;

      const rating = calculateRating(averageScore);
      const tier = getTier(averageScore);

      return {
        member,
        roundsCount,
        averageScore,
        bestScore,
        recentAverage,
        rating,
        tier,
        rounds: memberRounds,
      };
    });
  }, [members, rounds]);

  const teams = useMemo(() => buildTeamGroups(stats), [stats]);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const [{ data: storedMembers, error: memberError }, { data: storedRounds, error: roundError }, { data: storedSettings, error: settingsError }] =
        await Promise.all([
          supabase.from("members").select("*").order("name"),
          supabase.from("rounds").select("*").order("played_at", { ascending: false }),
          supabase.from("settings").select("*").order("key"),
        ]);

      setLoading(false);

      if (memberError || roundError || settingsError) {
        setStatusMessage("データの取得中に問題が発生しました。もう一度お試しください。");
        console.error(memberError ?? roundError ?? settingsError);
        return;
      }

      setMembers(storedMembers ?? []);
      setRounds(storedRounds ?? []);
      setSettings(
        (storedSettings ?? []).reduce((acc: Record<string, unknown>, row) => {
          if (row && typeof row === "object" && "key" in row && "value" in row) {
            acc[row.key as string] = row.value;
          }
          return acc;
        }, {})
      );
      setStatusMessage(null);
    }

    load();
  }, []);

  async function handleAddMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!newMemberName.trim()) return;

    setLoading(true);
    const { error } = await supabase.from("members").insert([{ name: newMemberName.trim() }]);
    setLoading(false);

    if (error) {
      setStatusMessage("メンバー追加に失敗しました。");
      console.error(error);
      return;
    }

    setNewMemberName("");
    setStatusMessage("メンバーを追加しました。");
    const { data: storedMembers } = await supabase.from("members").select("*").order("name");
    setMembers(storedMembers ?? []);
  }

  async function handleAddRound(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!newRound.memberId || !newRound.playedAt || !newRound.courseName.trim() || !newRound.score.trim()) {
      return;
    }

    const scoreValue = Number(newRound.score);
    if (!Number.isFinite(scoreValue) || scoreValue <= 0) return;

    setLoading(true);
    const { error } = await supabase.from("rounds").insert([
      {
        member_id: newRound.memberId,
        played_at: newRound.playedAt,
        course_name: newRound.courseName.trim(),
        score: scoreValue,
      },
    ]);
    setLoading(false);

    if (error) {
      setStatusMessage("スコア登録に失敗しました。");
      console.error(error);
      return;
    }

    setNewRound((current) => ({
      ...current,
      courseName: "",
      score: "",
    }));
    setStatusMessage("スコアを登録しました。");

    const { data: storedRounds } = await supabase.from("rounds").select("*").order("played_at", { ascending: false });
    setRounds(storedRounds ?? []);
  }

  const tierCounts = useMemo(() => {
    return stats.reduce(
      (acc, stat) => {
        acc[stat.tier] = (acc[stat.tier] ?? 0) + 1;
        return acc;
      },
      { S: 0, A: 0, B: 0, C: 0, D: 0 } as Record<string, number>
    );
  }, [stats]);

  const overallAverageScore = useMemo(() => {
    const scores = stats
      .map((stat) => stat.averageScore)
      .filter((value): value is number => value !== null);
    if (scores.length === 0) return null;
    return Number((scores.reduce((sum, score) => sum + score, 0) / scores.length).toFixed(1));
  }, [stats]);

  const teamGroups = useMemo(() => buildTeamGroups(stats), [stats]);
  const topStats = [...stats].sort((a, b) => b.rating - a.rating).slice(0, 5);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <div className="mx-auto flex min-h-screen max-w-5xl flex-col px-4 pb-24 pt-6 sm:px-6 lg:px-8">
        <header className="mb-6">
          <p className="text-sm font-semibold uppercase tracking-[0.3em] text-slate-500">ゴルフ Tier 表</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
            年末コンペ向け 10人ゴルフ管理
          </h1>
          <p className="mt-3 max-w-2xl text-slate-600 sm:text-lg">
            メンバー登録・ラウンド入力・自動Tier算出・2チーム分けをひとつの画面で管理します。
          </p>
        </header>

        <div className="space-y-6">
          <section id="summary" className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="overflow-hidden rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
                <p className="text-sm text-slate-500">登録メンバー</p>
                <p className="mt-4 text-3xl font-semibold text-slate-900">{members.length}</p>
              </div>
              <div className="overflow-hidden rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
                <p className="text-sm text-slate-500">平均スコア</p>
                <p className="mt-4 text-3xl font-semibold text-slate-900">{overallAverageScore ?? "-"}</p>
              </div>
              <div className="overflow-hidden rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
                <p className="text-sm text-slate-500">設定数</p>
                <p className="mt-4 text-3xl font-semibold text-slate-900">{Object.keys(settings).length}</p>
              </div>
              <div className="flex flex-col justify-between overflow-hidden rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
                <div>
                  <p className="text-sm text-slate-500">チーム分け</p>
                  <p className="mt-4 text-3xl font-semibold text-slate-900">{teamGroups.totals.teamA + teamGroups.totals.teamB > 0 ? teamGroups.totals.teamA + teamGroups.totals.teamB : "-"}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setTeamsVisible((visible) => !visible)}
                  className="mt-4 inline-flex w-full items-center justify-center rounded-3xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-700"
                >
                  {teamsVisible ? "チームを閉じる" : "チーム分けを表示"}
                </button>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-5">
              {(["S", "A", "B", "C", "D"] as const).map((tier) => (
                <div key={tier} className="rounded-3xl bg-white p-4 text-center shadow-sm ring-1 ring-slate-200">
                  <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">Tier {tier}</p>
                  <p className="mt-4 text-3xl font-semibold text-slate-900">{tierCounts[tier]}</p>
                </div>
              ))}
            </div>
          </section>

          {statusMessage ? (
            <div className="rounded-3xl border border-emerald-300/70 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
              {statusMessage}
            </div>
          ) : null}

          {teamsVisible ? (
            <section className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <h2 className="text-xl font-semibold text-slate-900">チーム分け結果</h2>
                  <p className="mt-1 text-sm text-slate-500">平均スコアに基づいて5人ずつに分けています。</p>
                </div>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-2">
                  <div className="rounded-3xl bg-slate-50 p-4 text-center">
                    <p className="text-sm text-slate-500">Team A 合計</p>
                    <p className="mt-2 text-2xl font-semibold text-slate-900">{teamGroups.totals.teamA}</p>
                  </div>
                  <div className="rounded-3xl bg-slate-50 p-4 text-center">
                    <p className="text-sm text-slate-500">Team B 合計</p>
                    <p className="mt-2 text-2xl font-semibold text-slate-900">{teamGroups.totals.teamB}</p>
                  </div>
                </div>
              </div>
              <div className="mt-6 grid gap-4 sm:grid-cols-2">
                <div className="rounded-3xl bg-slate-50 p-4">
                  <p className="text-sm font-semibold text-slate-900">Team A</p>
                  <ul className="mt-4 space-y-2 text-slate-700">
                    {teamGroups.teamA.map((player) => (
                      <li key={player.member.id} className="flex items-center justify-between rounded-2xl bg-white px-3 py-2">
                        <span>{player.member.name}</span>
                        <span className="text-sm font-semibold text-slate-900">{player.averageScore ?? "-"}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="rounded-3xl bg-slate-50 p-4">
                  <p className="text-sm font-semibold text-slate-900">Team B</p>
                  <ul className="mt-4 space-y-2 text-slate-700">
                    {teamGroups.teamB.map((player) => (
                      <li key={player.member.id} className="flex items-center justify-between rounded-2xl bg-white px-3 py-2">
                        <span>{player.member.name}</span>
                        <span className="text-sm font-semibold text-slate-900">{player.averageScore ?? "-"}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </section>
          ) : null}

          <section id="members" className="space-y-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="text-xl font-semibold text-slate-900">メンバー一覧</h2>
                <p className="mt-1 text-sm text-slate-500">メンバーごとのTierとレーティングを確認できます。</p>
              </div>
              <div className="rounded-2xl bg-slate-100 px-4 py-2 text-sm text-slate-600">
                {loading ? "読み込み中..." : "最新データ"}
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {stats.map((stat) => (
                <article key={stat.member.id} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-500">{stat.tier} Tier</p>
                      <h3 className="mt-3 text-lg font-semibold text-slate-900">{stat.member.name}</h3>
                    </div>
                    <div className="rounded-2xl bg-slate-900 px-3 py-2 text-right text-sm font-semibold text-white">
                      {stat.rating}
                    </div>
                  </div>
                  <div className="mt-5 grid gap-3 text-sm text-slate-600 sm:grid-cols-2">
                    <div className="rounded-3xl bg-slate-50 p-3">
                      <p className="font-medium text-slate-900">ラウンド数</p>
                      <p className="mt-2 text-xl">{stat.roundsCount}</p>
                    </div>
                    <div className="rounded-3xl bg-slate-50 p-3">
                      <p className="font-medium text-slate-900">平均</p>
                      <p className="mt-2 text-xl">{stat.averageScore ?? "-"}</p>
                    </div>
                    <div className="rounded-3xl bg-slate-50 p-3">
                      <p className="font-medium text-slate-900">ベスト</p>
                      <p className="mt-2 text-xl">{stat.bestScore ?? "-"}</p>
                    </div>
                    <div className="rounded-3xl bg-slate-50 p-3">
                      <p className="font-medium text-slate-900">直近5回</p>
                      <p className="mt-2 text-xl">{stat.recentAverage ?? "-"}</p>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </section>

          <section id="add-member" className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
            <article className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
              <h2 className="text-xl font-semibold text-slate-900">新しいメンバーを追加</h2>
              <p className="mt-2 text-sm text-slate-500">友人の名前を登録して、ラウンド入力を始めましょう。</p>
              <form onSubmit={handleAddMember} className="mt-6 space-y-4">
                <label className="block text-sm font-medium text-slate-700">名前</label>
                <input
                  value={newMemberName}
                  onChange={(event) => setNewMemberName(event.target.value)}
                  placeholder="例: 田中 太郎"
                  className="w-full rounded-3xl border border-slate-300 bg-slate-50 px-4 py-3 text-slate-900 outline-none transition focus:border-slate-500"
                />
                <button
                  type="submit"
                  className="inline-flex w-full items-center justify-center rounded-3xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-700"
                >
                  メンバーを追加
                </button>
              </form>
            </article>

            <article className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
              <h2 className="text-xl font-semibold text-slate-900">2チーム自動分け</h2>
              <p className="mt-2 text-sm text-slate-500">レーティング合計を近くするように5人ずつ自動で振り分けます。</p>
              <div className="mt-6 space-y-4">
                <div className="rounded-3xl bg-slate-50 p-4">
                  <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Team A</p>
                  <p className="mt-2 text-2xl font-semibold text-slate-900">{teams.totals.teamA}</p>
                </div>
                <div className="rounded-3xl bg-slate-50 p-4">
                  <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Team B</p>
                  <p className="mt-2 text-2xl font-semibold text-slate-900">{teams.totals.teamB}</p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-3xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
                    <p className="text-sm font-semibold text-slate-900">Team A</p>
                    <ul className="mt-3 space-y-2 text-slate-600">
                      {teams.teamA.map((player) => (
                        <li key={player.member.id} className="flex items-center justify-between rounded-2xl bg-slate-50 px-3 py-2">
                          <span>{player.member.name}</span>
                          <span className="text-sm font-semibold text-slate-900">{player.rating}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div className="rounded-3xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
                    <p className="text-sm font-semibold text-slate-900">Team B</p>
                    <ul className="mt-3 space-y-2 text-slate-600">
                      {teams.teamB.map((player) => (
                        <li key={player.member.id} className="flex items-center justify-between rounded-2xl bg-slate-50 px-3 py-2">
                          <span>{player.member.name}</span>
                          <span className="text-sm font-semibold text-slate-900">{player.rating}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            </article>
          </section>

          <section id="add-score" className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
            <h2 className="text-xl font-semibold text-slate-900">スコアを入力</h2>
            <p className="mt-2 text-sm text-slate-500">各メンバーの最新ラウンド結果を記録してください。</p>
            <form onSubmit={handleAddRound} className="mt-6 space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="text-sm font-medium text-slate-700">メンバー</span>
                  <select
                    value={newRound.memberId}
                    onChange={(event) => setNewRound((current) => ({ ...current, memberId: event.target.value }))}
                    className="mt-2 w-full rounded-3xl border border-slate-300 bg-slate-50 px-4 py-3 text-slate-900 outline-none focus:border-slate-500"
                  >
                    <option value="">選択してください</option>
                    {members.map((member) => (
                      <option key={member.id} value={member.id}>
                        {member.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="text-sm font-medium text-slate-700">日付</span>
                  <input
                    type="date"
                    value={newRound.playedAt}
                    onChange={(event) => setNewRound((current) => ({ ...current, playedAt: event.target.value }))}
                    className="mt-2 w-full rounded-3xl border border-slate-300 bg-slate-50 px-4 py-3 text-slate-900 outline-none focus:border-slate-500"
                  />
                </label>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="text-sm font-medium text-slate-700">ゴルフ場</span>
                  <input
                    value={newRound.courseName}
                    onChange={(event) => setNewRound((current) => ({ ...current, courseName: event.target.value }))}
                    placeholder="ゴルフ場名"
                    className="mt-2 w-full rounded-3xl border border-slate-300 bg-slate-50 px-4 py-3 text-slate-900 outline-none focus:border-slate-500"
                  />
                </label>
                <label className="block">
                  <span className="text-sm font-medium text-slate-700">スコア</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={newRound.score}
                    onChange={(event) => setNewRound((current) => ({ ...current, score: event.target.value }))}
                    placeholder="例: 82"
                    className="mt-2 w-full rounded-3xl border border-slate-300 bg-slate-50 px-4 py-3 text-slate-900 outline-none focus:border-slate-500"
                  />
                </label>
              </div>

              <button
                type="submit"
                className="inline-flex w-full items-center justify-center rounded-3xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-700"
              >
                スコアを保存
              </button>
            </form>
          </section>

          <section id="top-performers" className="space-y-4">
            <h2 className="text-xl font-semibold text-slate-900">注目ポイント</h2>
            <div className="grid gap-4 sm:grid-cols-3">
              {topStats.map((stat) => (
                <div key={stat.member.id} className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
                  <p className="text-sm text-slate-500">{stat.member.name}</p>
                  <p className="mt-3 text-2xl font-semibold text-slate-900">{stat.rating}</p>
                  <p className="mt-1 text-sm text-slate-600">Tier {stat.tier}</p>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>

      <nav className="fixed bottom-0 left-0 right-0 z-20 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur sm:px-6">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-2">
          {[
            { href: "#summary", label: "概要" },
            { href: "#members", label: "メンバー" },
            { href: "#add-score", label: "スコア入力" },
            { href: "#add-member", label: "追加" },
          ].map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="flex-1 rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3 text-center text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
            >
              {item.label}
            </a>
          ))}
        </div>
      </nav>
    </div>
  );
}
