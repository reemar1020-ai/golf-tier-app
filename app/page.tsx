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
  rounds: Round[];
  roundsCount: number;
  averageScore: number | null;
  bestScore: number | null;
  recentAverage: number | null;
  recentThreeMonthAverage: number | null;
  recentOneYearAverage: number | null;
  rating: number;
  tier: string;
};

type RoundGroup = {
  date: string;
  course: string;
  entries: Array<{
    memberId: string;
    memberName: string;
    score: number;
  }>;
  minScore: number;
  minMemberName: string;
};

type TabKey = "score" | "tier";

type ChampionshipResult = "win" | "runner-up" | "third" | "none";

type TeamSplit = {
  teamA: MemberStats[];
  teamB: MemberStats[];
  totals: { teamA: number; teamB: number };
  difference: number;
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

function getDateValue(value: string) {
  return new Date(`${value}T00:00:00`);
}

function getRecentAverage(rounds: Round[], days: number) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const recentRounds = rounds.filter((round) => {
    const playedAt = getDateValue(round.played_at);
    return playedAt >= cutoff;
  });

  if (recentRounds.length === 0) return null;
  const total = recentRounds.reduce((sum, round) => sum + round.score, 0);
  return Number((total / recentRounds.length).toFixed(1));
}

function getBestScore(rounds: Round[], days: number) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const recentRounds = rounds.filter((round) => {
    const playedAt = getDateValue(round.played_at);
    return playedAt >= cutoff;
  });
  if (recentRounds.length === 0) return null;
  return Math.min(...recentRounds.map((round) => round.score));
}

function getScorePoints(averageScore: number | null) {
  if (averageScore === null) return 0;
  if (averageScore <= 79) return 200;
  if (averageScore <= 84) return 180;
  if (averageScore <= 89) return 160;
  if (averageScore <= 94) return 140;
  if (averageScore <= 99) return 120;
  if (averageScore <= 104) return 100;
  if (averageScore <= 109) return 80;
  if (averageScore <= 114) return 60;
  if (averageScore <= 119) return 40;
  if (averageScore <= 129) return 20;
  if (averageScore <= 139) return 10;
  return 5;
}

function calculateTier(rating: number) {
  if (rating >= 150) return "S";
  if (rating >= 100) return "A";
  if (rating >= 50) return "B";
  return "C";
}

function calculateRating(rounds: Round[], championshipResult: ChampionshipResult) {
  const recentThreeMonthAverage = getRecentAverage(rounds, 90);
  const recentOneYearAverage = getRecentAverage(rounds, 365);
  const recentBestScore = getBestScore(rounds, 365);

  let points = getScorePoints(recentThreeMonthAverage);

  if (
    recentThreeMonthAverage !== null &&
    recentBestScore !== null &&
    recentBestScore <= recentThreeMonthAverage - 10
  ) {
    points += 30;
  }

  if (
    recentThreeMonthAverage !== null &&
    recentOneYearAverage !== null &&
    recentThreeMonthAverage <= recentOneYearAverage - 10
  ) {
    points += 15;
  }

  const resultBonus =
    championshipResult === "win"
      ? 15
      : championshipResult === "runner-up"
      ? 10
      : championshipResult === "third"
      ? 5
      : 0;

  return points + resultBonus;
}

function groupRoundsByDateAndCourse(rounds: Round[]) {
  const grouped = new Map<string, RoundGroup>();

  rounds.forEach((round) => {
    const key = `${round.played_at}::${round.course_name}`;
    if (!grouped.has(key)) {
      grouped.set(key, {
        date: round.played_at,
        course: round.course_name,
        entries: [],
        minScore: round.score,
        minMemberName: "",
      });
    }

    const group = grouped.get(key)!;
    group.entries.push({
      memberId: round.member_id,
      memberName: "",
      score: round.score,
    });

    if (round.score < group.minScore) {
      group.minScore = round.score;
    }
  });

  return Array.from(grouped.values())
    .sort((a, b) => b.date.localeCompare(a.date))
    .map((group) => ({
      ...group,
      entries: group.entries.sort((a, b) => a.score - b.score),
    }));
}

function generateBalancedTeams(stats: MemberStats[]) {
  if (stats.length === 0) {
    return {
      teamA: [] as MemberStats[],
      teamB: [] as MemberStats[],
      totals: { teamA: 0, teamB: 0 },
      difference: 0,
    };
  }

  const teamSize = Math.floor(stats.length / 2);
  const members = stats.map((stat, index) => ({ stat, index }));
  let best: TeamSplit | null = null;

  const choose = (start: number, chosen: number[], currentTeam: MemberStats[]) => {
    if (currentTeam.length === teamSize) {
      const teamA = currentTeam;
      const teamB = members.filter((member) => !chosen.includes(member.index)).map((member) => member.stat);
      const totals = {
        teamA: teamA.reduce((sum, item) => sum + item.rating, 0),
        teamB: teamB.reduce((sum, item) => sum + item.rating, 0),
      };
      const difference = Math.abs(totals.teamA - totals.teamB);
      const candidate = {
        teamA,
        teamB,
        totals,
        difference,
      };

      if (!best || candidate.difference < best.difference) {
        best = candidate;
      }
      return;
    }

    for (let i = start; i < members.length; i += 1) {
      if (chosen.includes(i)) continue;
      chosen.push(i);
      choose(i + 1, chosen, [...currentTeam, members[i].stat]);
      chosen.pop();
    }
  };

  choose(0, [], []);

  if (!best) {
    return {
      teamA: [],
      teamB: [],
      totals: { teamA: 0, teamB: 0 },
      difference: 0,
    };
  }

  return best;
}

export default function Home() {
  const [members, setMembers] = useState<Member[]>([]);
  const [rounds, setRounds] = useState<Round[]>([]);
  const [settings, setSettings] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>("score");
  const [newMemberName, setNewMemberName] = useState("");
  const [isMemberComposerOpen, setIsMemberComposerOpen] = useState(false);
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);
  const [scoreDrafts, setScoreDrafts] = useState<Record<string, string>>({});
  const [newRound, setNewRound] = useState({
    courseName: "",
    playedAt: defaultPlayedAt,
  });
  const [expandedHistoryId, setExpandedHistoryId] = useState<string | null>(null);
  const [expandedDetail, setExpandedDetail] = useState<"tier" | "ranking" | "teams" | null>("tier");
  const [selectedRankingMemberId, setSelectedRankingMemberId] = useState<string | null>(null);
  const [teamVersion, setTeamVersion] = useState(0);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const hash = window.location.hash;
      if (hash === "#tier") {
        setActiveTab("tier");
      }
    }
  }, []);

  useEffect(() => {
    if (members.length > 0 && (selectedMemberIds.length === 0 || selectedMemberIds.some((id) => !members.some((member) => member.id === id)))) {
      setSelectedMemberIds(members.map((member) => member.id));
    }
  }, [members, selectedMemberIds]);

  useEffect(() => {
    async function load() {
      setLoading(true);
      if (!supabase) {
        setLoading(false);
        setStatusMessage("Supabaseの接続設定が未設定のため、データ読み込みできません。");
        return;
      }

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

      setMembers((storedMembers ?? []) as Member[]);
      setRounds((storedRounds ?? []) as Round[]);
      setSettings(
        (storedSettings ?? []).reduce((acc: Record<string, unknown>, row) => {
          if (row && typeof row === "object" && "key" in row && "value" in row) {
            acc[row.key as string] = row.value;
          }
          return acc;
        }, {})
      );

      const storedResults = (storedSettings ?? []).find((row) => row && typeof row === "object" && "key" in row && row.key === "championship_results");
      if (storedResults && typeof storedResults.value === "string") {
        try {
          const parsed = JSON.parse(storedResults.value as string) as Record<string, ChampionshipResult>;
          setChampionshipResults(parsed);
        } catch {
          setChampionshipResults({});
        }
      }

      setStatusMessage(null);
    }

    load();
  }, []);

  const [championshipResults, setChampionshipResults] = useState<Record<string, ChampionshipResult>>({});

  const stats = useMemo<MemberStats[]>(() => {
    return members.map((member) => {
      const memberRounds = rounds
        .filter((round) => round.member_id === member.id)
        .sort((a, b) => new Date(b.played_at).getTime() - new Date(a.played_at).getTime());

      const scores = memberRounds.map((round) => round.score);
      const roundsCount = memberRounds.length;
      const averageScore =
        scores.length > 0
          ? Number((scores.reduce((sum, score) => sum + score, 0) / scores.length).toFixed(1))
          : null;
      const bestScore = scores.length > 0 ? Math.min(...scores) : null;
      const recentAverage = scores.length > 0 ? Number((scores.slice(0, 5).reduce((sum, score) => sum + score, 0) / Math.min(scores.slice(0, 5).length, 5)).toFixed(1)) : null;
      const recentThreeMonthAverage = getRecentAverage(memberRounds, 90);
      const recentOneYearAverage = getRecentAverage(memberRounds, 365);
      const rating = calculateRating(memberRounds, championshipResults[member.id] ?? "none");
      const tier = calculateTier(rating);

      return {
        member,
        rounds: memberRounds,
        roundsCount,
        averageScore,
        bestScore,
        recentAverage,
        recentThreeMonthAverage,
        recentOneYearAverage,
        rating,
        tier,
      };
    });
  }, [members, rounds, championshipResults]);

  const roundGroups = useMemo(() => groupRoundsByDateAndCourse(rounds), [rounds]);

  const tierGroups = useMemo(() => {
    const groups = { S: [] as MemberStats[], A: [] as MemberStats[], B: [] as MemberStats[], C: [] as MemberStats[] };
    stats.forEach((stat) => {
      if (stat.tier === "S") groups.S.push(stat);
      if (stat.tier === "A") groups.A.push(stat);
      if (stat.tier === "B") groups.B.push(stat);
      if (stat.tier === "C") groups.C.push(stat);
    });
    return groups;
  }, [stats]);

  const rankingByRate = useMemo(() => [...stats].sort((a, b) => b.rating - a.rating), [stats]);
  const rankingByBest = useMemo(() => [...stats].sort((a, b) => (a.bestScore ?? Number.POSITIVE_INFINITY) - (b.bestScore ?? Number.POSITIVE_INFINITY)), [stats]);
  const teamSplit = useMemo(() => {
    const selectedStats = stats.filter((stat) => selectedMemberIds.includes(stat.member.id));
    return generateBalancedTeams(selectedStats);
  }, [stats, selectedMemberIds, teamVersion]);

  async function handleAddMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!newMemberName.trim()) return;
    if (!supabase) {
      setStatusMessage("Supabaseの接続設定がないため、保存できません。");
      return;
    }

    setLoading(true);
    const { error } = await supabase.from("members").insert([{ name: newMemberName.trim() }]);
    setLoading(false);

    if (error) {
      setStatusMessage("メンバー追加に失敗しました。");
      console.error(error);
      return;
    }

    setNewMemberName("");
    setIsMemberComposerOpen(false);
    setStatusMessage("メンバーを追加しました。");
    const { data: storedMembers } = await supabase.from("members").select("*").order("name");
    setMembers((storedMembers ?? []) as Member[]);
  }

  async function handleSaveScores(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) {
      setStatusMessage("Supabaseの接続設定がないため、保存できません。");
      return;
    }

    const selectedMembers = members.filter((member) => selectedMemberIds.includes(member.id));
    if (selectedMembers.length === 0 || !newRound.courseName.trim()) {
      setStatusMessage("メンバーとゴルフ場を選択してください。");
      return;
    }

    setLoading(true);

    for (const member of selectedMembers) {
      const scoreText = scoreDrafts[member.id] ?? "";
      const scoreValue = Number(scoreText);
      if (!scoreText.trim() || !Number.isFinite(scoreValue) || scoreValue <= 0) {
        setLoading(false);
        setStatusMessage("各メンバーのスコアを入力してください。");
        return;
      }

      const { data: existingRounds, error: existingError } = await supabase
        .from("rounds")
        .select("*")
        .eq("member_id", member.id)
        .eq("played_at", newRound.playedAt)
        .eq("course_name", newRound.courseName.trim());

      if (existingError) {
        setLoading(false);
        setStatusMessage("スコア保存中にエラーが発生しました。再度お試しください。" );
        console.error(existingError);
        return;
      }

      if ((existingRounds ?? []).length > 0) {
        const existingRound = existingRounds?.[0];
        const { error: updateError } = await supabase.from("rounds").update({ score: scoreValue }).eq("id", existingRound.id);
        if (updateError) {
          setLoading(false);
          setStatusMessage("スコア更新に失敗しました。");
          console.error(updateError);
          return;
        }
      } else {
        const { error: insertError } = await supabase.from("rounds").insert([
          {
            member_id: member.id,
            played_at: newRound.playedAt,
            course_name: newRound.courseName.trim(),
            score: scoreValue,
          },
        ]);
        if (insertError) {
          setLoading(false);
          setStatusMessage("スコア登録に失敗しました。");
          console.error(insertError);
          return;
        }
      }
    }

    setLoading(false);
    setStatusMessage("スコアを保存しました。");
    const { data: storedRounds } = await supabase.from("rounds").select("*").order("played_at", { ascending: false });
    setRounds((storedRounds ?? []) as Round[]);
    setScoreDrafts({});
    setNewRound({ courseName: "", playedAt: defaultPlayedAt });
  }

  async function handleSaveChampionshipResult(memberId: string, result: ChampionshipResult) {
    if (!supabase) {
      setStatusMessage("Supabaseの接続設定がないため、保存できません。");
      return;
    }

    const nextResults = {
      ...championshipResults,
      [memberId]: result,
    };

    setChampionshipResults(nextResults);
    const { error } = await supabase.from("settings").upsert([
      { key: "championship_results", value: JSON.stringify(nextResults) },
    ]);

    if (error) {
      setStatusMessage("大会結果の保存に失敗しました。");
      console.error(error);
      return;
    }

    setStatusMessage("大会結果を保存しました。");
  }

  function toggleMemberSelection(memberId: string) {
    setSelectedMemberIds((current) => (current.includes(memberId) ? current.filter((id) => id !== memberId) : [...current, memberId]));
  }

  const selectedMembers = useMemo(() => members.filter((member) => selectedMemberIds.includes(member.id)), [members, selectedMemberIds]);
  const selectedMemberDetails = useMemo(() => stats.filter((stat) => selectedMemberIds.includes(stat.member.id)), [stats, selectedMemberIds]);
  const activeRankingMember = stats.find((stat) => stat.member.id === selectedRankingMemberId) ?? null;

  return (
    <div className="min-h-screen overflow-x-hidden bg-[#111111] text-[#111111]">
      <div className="mx-auto flex min-h-screen max-w-5xl flex-col px-3 pb-28 pt-0 sm:px-4">
        <header className="sticky top-0 z-30 border-b border-[#2b2b2b] bg-[#111111] px-3 py-4 sm:px-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.35em] text-[#b91c1c]">Golf Tier</p>
          <h1 className="mt-2 text-[28px] font-semibold text-[#f5e8e8] sm:text-[34px]" style={{ fontFamily: "Georgia, 'Times New Roman', serif" }}>
            南高ゴルフ部Tier表
          </h1>
        </header>

        <main className="flex-1 py-4">
          {statusMessage ? (
            <div className="mb-4 rounded-[20px] border border-[#d6d3d1] bg-[#fff7ed] px-4 py-3 text-sm text-[#7c2d12] shadow-sm">
              {statusMessage}
            </div>
          ) : null}

          {activeTab === "score" ? (
            <div className="space-y-4">
              <section className="rounded-[28px] border border-[#e7e5e4] bg-white p-4 shadow-sm">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-[18px] font-semibold text-[#111111]">スコア入力</h2>
                    <p className="mt-1 text-sm text-[#6b7280]">ゴルフ場・日付・参加者・スコアをまとめて保存できます。</p>
                  </div>
                  <div className="rounded-full bg-[#fef2f2] px-3 py-1 text-sm font-semibold text-[#b91c1c]">iPhone最適化</div>
                </div>

                <form onSubmit={handleSaveScores} className="mt-5 space-y-4">
                  <label className="block text-sm font-medium text-[#111111]">
                    ゴルフ場
                    <input
                      value={newRound.courseName}
                      onChange={(event) => setNewRound((current) => ({ ...current, courseName: event.target.value }))}
                      placeholder="例: 霞ヶ関CC"
                      className="mt-2 h-[46px] w-full rounded-[18px] border border-[#d1d5db] bg-[#f9fafb] px-4 text-[16px] text-[#111111] outline-none focus:border-[#b91c1c]"
                    />
                  </label>

                  <label className="block text-sm font-medium text-[#111111]">
                    日付
                    <input
                      type="date"
                      value={newRound.playedAt}
                      onChange={(event) => setNewRound((current) => ({ ...current, playedAt: event.target.value }))}
                      className="mt-2 h-[46px] w-full rounded-[18px] border border-[#d1d5db] bg-[#f9fafb] px-4 text-[16px] text-[#111111] outline-none focus:border-[#b91c1c]"
                    />
                  </label>

                  <div className="rounded-[24px] border border-[#e5e7eb] bg-[#fafafa] p-3">
                    <div className="mb-3 flex items-center justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold text-[#111111]">メンバー</p>
                        <p className="text-xs text-[#6b7280]">複数選択してスコアを入力できます。</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setIsMemberComposerOpen((open) => !open)}
                        className="flex h-[44px] min-w-[44px] items-center justify-center rounded-full bg-[#111111] px-3 text-lg font-semibold text-white"
                      >
                        +
                      </button>
                    </div>

                    {isMemberComposerOpen ? (
                      <form onSubmit={handleAddMember} className="mb-3 space-y-2 rounded-[18px] border border-[#e5e7eb] bg-white p-3">
                        <input
                          value={newMemberName}
                          onChange={(event) => setNewMemberName(event.target.value)}
                          placeholder="新しいメンバー名"
                          className="h-[44px] w-full rounded-[14px] border border-[#d1d5db] bg-[#f9fafb] px-3 text-[16px] text-[#111111] outline-none focus:border-[#b91c1c]"
                        />
                        <button type="submit" className="h-[44px] w-full rounded-[14px] bg-[#b91c1c] text-sm font-semibold text-white">
                          登録する
                        </button>
                      </form>
                    ) : null}

                    <div className="flex flex-wrap gap-2">
                      {members.map((member) => {
                        const active = selectedMemberIds.includes(member.id);
                        return (
                          <button
                            key={member.id}
                            type="button"
                            onClick={() => toggleMemberSelection(member.id)}
                            className={`rounded-full border px-3 py-2 text-sm font-semibold ${active ? "border-[#b91c1c] bg-[#fef2f2] text-[#b91c1c]" : "border-[#d1d5db] bg-white text-[#111111]"}`}
                          >
                            {member.name}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {selectedMembers.length > 0 ? (
                    <div className="space-y-3">
                      {selectedMembers.map((member) => (
                        <label key={member.id} className="block rounded-[20px] border border-[#e5e7eb] bg-[#f9fafb] p-3">
                          <div className="mb-2 text-sm font-semibold text-[#111111]">{member.name}</div>
                          <input
                            type="text"
                            inputMode="numeric"
                            pattern="[0-9]*"
                            value={scoreDrafts[member.id] ?? ""}
                            onChange={(event) => setScoreDrafts((current) => ({ ...current, [member.id]: event.target.value }))}
                            placeholder="スコア"
                            className="h-[46px] w-full rounded-[14px] border border-[#d1d5db] bg-white px-3 text-[16px] text-[#111111] outline-none focus:border-[#b91c1c]"
                          />
                        </label>
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-[20px] border border-dashed border-[#d1d5db] p-4 text-sm text-[#6b7280]">
                      まずはメンバーを選択してください。
                    </div>
                  )}

                  <button type="submit" className="h-[48px] w-full rounded-[18px] bg-[#111111] text-sm font-semibold text-white">
                    保存する
                  </button>
                </form>
              </section>

              <section className="rounded-[28px] border border-[#e7e5e4] bg-white p-4 shadow-sm">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-[18px] font-semibold text-[#111111]">ラウンド履歴</h2>
                    <p className="mt-1 text-sm text-[#6b7280]">日付とゴルフ場単位でまとめて表示します。</p>
                  </div>
                  <span className="rounded-full bg-[#fef2f2] px-3 py-1 text-sm font-semibold text-[#b91c1c]">{roundGroups.length}</span>
                </div>

                {roundGroups.length === 0 ? (
                  <div className="rounded-[20px] border border-dashed border-[#d1d5db] p-5 text-sm text-[#6b7280]">
                    まだデータがありません。
                  </div>
                ) : (
                  <div className="space-y-3">
                    {roundGroups.map((group) => {
                      const isOpen = expandedHistoryId === `${group.date}-${group.course}`;
                      return (
                        <div key={`${group.date}-${group.course}`} className="rounded-[20px] border border-[#e5e7eb] bg-[#fafafa] p-3">
                          <button type="button" onClick={() => setExpandedHistoryId(isOpen ? null : `${group.date}-${group.course}`)} className="flex w-full items-center justify-between gap-3 text-left">
                            <div>
                              <p className="text-sm font-semibold text-[#111111]">{formatDate(group.date)}</p>
                              <p className="mt-1 text-sm text-[#6b7280]">{group.course}</p>
                            </div>
                            <div className="text-right">
                              <p className="text-sm font-semibold text-[#b91c1c]">最少 {group.minScore}</p>
                              <p className="mt-1 text-xs text-[#6b7280]">{group.entries[0]?.memberName || "-"}</p>
                            </div>
                          </button>

                          {isOpen ? (
                            <div className="mt-3 space-y-2">
                              {group.entries
                                .slice()
                                .sort((a, b) => a.score - b.score)
                                .map((entry) => (
                                  <div key={`${group.date}-${group.course}-${entry.memberId}`} className="flex items-center justify-between rounded-[16px] border border-[#e5e7eb] bg-white px-3 py-2">
                                    <span className="text-sm text-[#111111]">{entry.memberName || entry.memberId}</span>
                                    <span className="text-sm font-semibold text-[#111111]">{entry.score}</span>
                                  </div>
                                ))}
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            </div>
          ) : (
            <div className="space-y-4">
              <section className="rounded-[28px] border border-[#e7e5e4] bg-white p-4 shadow-sm">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-[18px] font-semibold text-[#111111]">Tier表</h2>
                    <p className="mt-1 text-sm text-[#6b7280]">レート点数に応じてS〜Cで分類します。</p>
                  </div>
                  <button type="button" onClick={() => setExpandedDetail((current) => (current === "tier" ? null : "tier"))} className="rounded-full bg-[#111111] px-3 py-2 text-sm font-semibold text-white">
                    {expandedDetail === "tier" ? "閉じる" : "開く"}
                  </button>
                </div>
                {expandedDetail === "tier" ? (
                  <div className="mt-4 space-y-3">
                    {(["S", "A", "B", "C"] as const).map((tier) => (
                      <div key={tier} className="rounded-[20px] border border-[#e5e7eb] bg-[#fafafa] p-3">
                        <div className="mb-2 flex items-center justify-between">
                          <p className="text-sm font-semibold text-[#111111]">Tier {tier}</p>
                          <span className="rounded-full bg-[#fef2f2] px-3 py-1 text-sm font-semibold text-[#b91c1c]">{tierGroups[tier].length}</span>
                        </div>
                        <div className="space-y-2">
                          {tierGroups[tier].length === 0 ? (
                            <p className="text-sm text-[#6b7280]">まだデータがありません。</p>
                          ) : (
                            tierGroups[tier].map((stat) => (
                              <div key={stat.member.id} className="rounded-[16px] border border-[#e5e7eb] bg-white p-3">
                                <div className="flex items-center justify-between gap-2">
                                  <p className="text-sm font-semibold text-[#111111]">{stat.member.name}</p>
                                  <p className="text-sm font-semibold text-[#111111]">{stat.rating}pt</p>
                                </div>
                                <p className="mt-1 text-xs text-[#6b7280]">平均 {stat.averageScore ?? "-"} / ベスト {stat.bestScore ?? "-"}</p>
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}
              </section>

              <section className="rounded-[28px] border border-[#e7e5e4] bg-white p-4 shadow-sm">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-[18px] font-semibold text-[#111111]">個人ランキング</h2>
                    <p className="mt-1 text-sm text-[#6b7280]">レート点数とベストスコアをランキング化します。</p>
                  </div>
                  <button type="button" onClick={() => setExpandedDetail((current) => (current === "ranking" ? null : "ranking"))} className="rounded-full bg-[#111111] px-3 py-2 text-sm font-semibold text-white">
                    {expandedDetail === "ranking" ? "閉じる" : "開く"}
                  </button>
                </div>

                {expandedDetail === "ranking" ? (
                  <div className="mt-4 space-y-4">
                    <div className="rounded-[20px] border border-[#e5e7eb] bg-[#fafafa] p-3">
                      <p className="text-sm font-semibold text-[#111111]">レート点数ランキング</p>
                      <div className="mt-3 space-y-2">
                        {rankingByRate.map((stat, index) => (
                          <button key={stat.member.id} type="button" onClick={() => setSelectedRankingMemberId(stat.member.id)} className="flex w-full items-center justify-between rounded-[16px] border border-[#e5e7eb] bg-white px-3 py-3 text-left">
                            <span className="text-sm font-semibold text-[#111111]">{index + 1}. {stat.member.name}</span>
                            <span className="text-sm font-semibold text-[#b91c1c]">{stat.rating}pt</span>
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="rounded-[20px] border border-[#e5e7eb] bg-[#fafafa] p-3">
                      <p className="text-sm font-semibold text-[#111111]">ベストスコアランキング</p>
                      <div className="mt-3 space-y-2">
                        {rankingByBest.map((stat, index) => (
                          <button key={stat.member.id} type="button" onClick={() => setSelectedRankingMemberId(stat.member.id)} className="flex w-full items-center justify-between rounded-[16px] border border-[#e5e7eb] bg-white px-3 py-3 text-left">
                            <span className="text-sm font-semibold text-[#111111]">{index + 1}. {stat.member.name}</span>
                            <span className="text-sm font-semibold text-[#111111]">{stat.bestScore ?? "-"}</span>
                          </button>
                        ))}
                      </div>
                    </div>

                    {activeRankingMember ? (
                      <div className="rounded-[20px] border border-[#e5e7eb] bg-[#fafafa] p-3">
                        <p className="text-sm font-semibold text-[#111111]">{activeRankingMember.member.name}の詳細</p>
                        <div className="mt-3 grid gap-2 text-sm text-[#111111]">
                          <div className="rounded-[16px] border border-[#e5e7eb] bg-white p-3">ベストスコア: {activeRankingMember.bestScore ?? "-"}</div>
                          <div className="rounded-[16px] border border-[#e5e7eb] bg-white p-3">平均スコア: {activeRankingMember.averageScore ?? "-"}</div>
                          <div className="rounded-[16px] border border-[#e5e7eb] bg-white p-3">直近3か月平均: {activeRankingMember.recentThreeMonthAverage ?? "-"}</div>
                          <div className="rounded-[16px] border border-[#e5e7eb] bg-white p-3">レート点数: {activeRankingMember.rating}pt</div>
                          <div className="rounded-[16px] border border-[#e5e7eb] bg-white p-3">Tier: {activeRankingMember.tier}</div>
                        </div>
                        <div className="mt-3 space-y-2">
                          <p className="text-sm font-semibold text-[#111111]">スコア履歴</p>
                          {activeRankingMember.rounds.slice().sort((a, b) => b.played_at.localeCompare(a.played_at)).map((round) => (
                            <div key={round.id} className="flex items-center justify-between rounded-[16px] border border-[#e5e7eb] bg-white px-3 py-2 text-sm">
                              <span>{formatDate(round.played_at)} · {round.course_name}</span>
                              <span className="font-semibold">{round.score}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </section>

              <section className="rounded-[28px] border border-[#e7e5e4] bg-white p-4 shadow-sm">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-[18px] font-semibold text-[#111111]">自動チーム分け</h2>
                    <p className="mt-1 text-sm text-[#6b7280]">対象メンバーを選んで2チームへ自動分けします。</p>
                  </div>
                  <button type="button" onClick={() => setExpandedDetail((current) => (current === "teams" ? null : "teams"))} className="rounded-full bg-[#111111] px-3 py-2 text-sm font-semibold text-white">
                    {expandedDetail === "teams" ? "閉じる" : "開く"}
                  </button>
                </div>
                {expandedDetail === "teams" ? (
                  <div className="mt-4 space-y-4">
                    <div className="flex flex-wrap gap-2">
                      {members.map((member) => {
                        const active = selectedMemberIds.includes(member.id);
                        return (
                          <button key={member.id} type="button" onClick={() => toggleMemberSelection(member.id)} className={`rounded-full border px-3 py-2 text-sm font-semibold ${active ? "border-[#b91c1c] bg-[#fef2f2] text-[#b91c1c]" : "border-[#d1d5db] bg-white text-[#111111]"}`}>
                            {member.name}
                          </button>
                        );
                      })}
                    </div>

                    <div className="rounded-[20px] border border-[#e5e7eb] bg-[#fafafa] p-3">
                      <div className="grid gap-2 sm:grid-cols-2">
                        <div className="rounded-[16px] border border-[#e5e7eb] bg-white p-3">
                          <p className="text-sm font-semibold text-[#111111]">Team A</p>
                          {teamSplit.teamA.length === 0 ? <p className="mt-2 text-sm text-[#6b7280]">未選択</p> : teamSplit.teamA.map((stat) => <p key={stat.member.id} className="mt-2 text-sm text-[#111111]">{stat.member.name}</p>)}
                        </div>
                        <div className="rounded-[16px] border border-[#e5e7eb] bg-white p-3">
                          <p className="text-sm font-semibold text-[#111111]">Team B</p>
                          {teamSplit.teamB.length === 0 ? <p className="mt-2 text-sm text-[#6b7280]">未選択</p> : teamSplit.teamB.map((stat) => <p key={stat.member.id} className="mt-2 text-sm text-[#111111]">{stat.member.name}</p>)}
                        </div>
                      </div>
                      <div className="mt-3 rounded-[16px] border border-[#e5e7eb] bg-white p-3 text-sm text-[#111111]">
                        <p>Team A合計: {teamSplit.totals.teamA}</p>
                        <p className="mt-1">Team B合計: {teamSplit.totals.teamB}</p>
                        <p className="mt-1">レート差: {teamSplit.difference}</p>
                      </div>
                    </div>

                    <button type="button" onClick={() => setTeamVersion((current) => current + 1)} className="h-[44px] w-full rounded-[16px] bg-[#b91c1c] text-sm font-semibold text-white">
                      再計算する
                    </button>
                  </div>
                ) : null}
              </section>

              <section className="rounded-[28px] border border-[#e7e5e4] bg-white p-4 shadow-sm">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-[18px] font-semibold text-[#111111]">大会結果</h2>
                    <p className="mt-1 text-sm text-[#6b7280]">昨年の年末コンペ結果を入力できます。</p>
                  </div>
                </div>
                <div className="space-y-2">
                  {members.map((member) => (
                    <label key={member.id} className="flex items-center justify-between rounded-[16px] border border-[#e5e7eb] bg-[#fafafa] px-3 py-3 text-sm">
                      <span className="font-semibold text-[#111111]">{member.name}</span>
                      <select
                        value={championshipResults[member.id] ?? "none"}
                        onChange={(event) => handleSaveChampionshipResult(member.id, event.target.value as ChampionshipResult)}
                        className="rounded-[12px] border border-[#d1d5db] bg-white px-2 py-2 text-sm text-[#111111]"
                      >
                        <option value="none">なし</option>
                        <option value="third">3位</option>
                        <option value="runner-up">準優勝</option>
                        <option value="win">優勝</option>
                      </select>
                    </label>
                  ))}
                </div>
              </section>
            </div>
          )}
        </main>
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-[#2b2b2b] bg-[#111111] px-3 py-3 pb-[calc(env(safe-area-inset-bottom)+12px)]">
        <div className="mx-auto flex max-w-3xl gap-2">
          <button type="button" onClick={() => setActiveTab("score")} className={`flex-1 rounded-[16px] px-3 py-3 text-sm font-semibold ${activeTab === "score" ? "bg-[#fef2f2] text-[#b91c1c]" : "bg-[#1f1f1f] text-[#f5e8e8]"}`}>
            スコア入力
          </button>
          <button type="button" onClick={() => setActiveTab("tier")} className={`flex-1 rounded-[16px] px-3 py-3 text-sm font-semibold ${activeTab === "tier" ? "bg-[#fef2f2] text-[#b91c1c]" : "bg-[#1f1f1f] text-[#f5e8e8]"}`}>
            Tier表
          </button>
        </div>
      </nav>
    </div>
  );
}
