"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase";

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

type TabKey = "score" | "tier" | "results";

type ChampionshipResult = "win" | "runner-up" | "third" | "none";

type CompetitionEntry = {
  memberId: string;
  memberName: string;
  score: number;
  rating: number;
};

type CompetitionRecord = {
  id: string;
  date: string;
  courseName: string;
  teams: {
    A: CompetitionEntry[];
    B: CompetitionEntry[];
  };
  teamScores: {
    A: number;
    B: number;
  };
  winner: "A" | "B" | "draw";
  teamTotals?: {
    A: number;
    B: number;
  };
  scoreTotals?: {
    A: number;
    B: number;
  };
};

type TeamSplit = {
  teamA: MemberStats[];
  teamB: MemberStats[];
  totals: { teamA: number; teamB: number };
  difference: number;
};

const defaultPlayedAt = new Date().toISOString().slice(0, 10);

function parseCompetitions(value: unknown): CompetitionRecord[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is CompetitionRecord => Boolean(item && typeof item === "object"));
}

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

function groupRoundsByDateAndCourse(rounds: Round[], members: Member[]) {
  const memberNameById = Object.fromEntries(members.map((member) => [member.id, member.name]));
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
    const memberName = memberNameById[round.member_id] ?? "未登録";
    group.entries.push({
      memberId: round.member_id,
      memberName,
      score: round.score,
    });

    if (round.score < group.minScore) {
      group.minScore = round.score;
    }
  });

  return Array.from(grouped.values())
    .sort((a, b) => b.date.localeCompare(a.date))
    .map((group) => {
      const sortedEntries = group.entries.sort((a, b) => a.score - b.score);
      const bestEntry = sortedEntries[0];
      return {
        ...group,
        entries: sortedEntries,
        minMemberName: bestEntry?.memberName ?? "-",
      };
    });
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
  const [isEditMembersMode, setIsEditMembersMode] = useState(false);
  const [editMemberId, setEditMemberId] = useState<string | null>(null);
  const [editMemberName, setEditMemberName] = useState("");
  const [isCompetitionMode, setIsCompetitionMode] = useState(false);
  const [competitionRecords, setCompetitionRecords] = useState<CompetitionRecord[]>([]);
  const [isCompetitionEditing, setIsCompetitionEditing] = useState(false);
  const [isCompetitionStarted, setIsCompetitionStarted] = useState(false);
  const [competitionDraftTeams, setCompetitionDraftTeams] = useState<{ A: Member[]; B: Member[] }>({ A: [], B: [] });
  const [competitionScoreDrafts, setCompetitionScoreDrafts] = useState<Record<string, string>>({});
  const [expandedCompetitionYear, setExpandedCompetitionYear] = useState<string | null>(null);

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
      const client: any = getSupabaseClient();
      if (!client) {
        setLoading(false);
        setStatusMessage("Supabaseの接続設定が未設定のため、データ読み込みできません。" );
        return;
      }

      const [{ data: storedMembers, error: memberError }, { data: storedRounds, error: roundError }, { data: storedSettings, error: settingsError }] =
        await Promise.all([
          client.from("members").select("*").order("created_at", { ascending: true }),
          client.from("rounds").select("*").order("played_at", { ascending: false }),
          client.from("settings").select("*").order("key"),
        ]);

      setLoading(false);

      if (memberError || roundError || settingsError) {
        const err = memberError ?? roundError ?? settingsError;
        console.error("Supabase load error:", {
          message: err?.message,
          code: err?.code,
          details: err?.details,
          hint: err?.hint,
        });
        let displayMsg = "データの取得中に問題が発生しました。";
        if (memberError) displayMsg = `メンバー取得エラー: ${memberError.message}`;
        else if (roundError) displayMsg = `ラウンド取得エラー: ${roundError.message}`;
        else if (settingsError) displayMsg = `設定取得エラー: ${settingsError.message}`;
        if (err?.message?.toLowerCase().includes("policy") || err?.message?.toLowerCase().includes("rls") || err?.message?.toLowerCase().includes("permission")) {
          displayMsg += " — SupabaseのRLSまたはPolicy設定が原因で取得できない可能性があります。";
        }
        setStatusMessage(displayMsg);
        return;
      }

      const storedSettingsRows = (storedSettings ?? []) as Array<Record<string, unknown>>;
      setMembers((storedMembers ?? []) as Member[]);
      setRounds((storedRounds ?? []) as Round[]);
      setSettings(
        storedSettingsRows.reduce((acc: Record<string, unknown>, row) => {
          const setting = row as { key?: unknown; value?: unknown };
          if (typeof setting.key === "string") {
            acc[setting.key] = setting.value;
          }
          return acc;
        }, {})
      );

      const storedResults = storedSettingsRows.find((row) => {
        const setting = row as { key?: unknown };
        return typeof setting.key === "string" && setting.key === "championship_results";
      });
      if (storedResults) {
        const setting = storedResults as { value?: unknown };
        if (typeof setting.value === "string") {
          try {
            const parsed = JSON.parse(setting.value) as Record<string, ChampionshipResult>;
            setChampionshipResults(parsed);
          } catch {
            setChampionshipResults({});
          }
        }
      }

      const storedCompetitions = storedSettingsRows.find((row) => {
        const setting = row as { key?: unknown };
        return typeof setting.key === "string" && setting.key === "competitions";
      });
      if (storedCompetitions) {
        const setting = storedCompetitions as { value?: unknown };
        if (typeof setting.value === "string") {
          try {
            const parsed = JSON.parse(setting.value) as CompetitionRecord[];
            setCompetitionRecords(parsed);
          } catch {
            setCompetitionRecords([]);
          }
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

  const roundGroups = useMemo(() => groupRoundsByDateAndCourse(rounds, members), [rounds, members]);

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
  const competitionSplitPreview = useMemo(() => {
    const selectedStats = stats.filter((stat) => selectedMemberIds.includes(stat.member.id));
    return generateBalancedTeams(selectedStats);
  }, [stats, selectedMemberIds, teamVersion]);
  const activeCompetitionTeams = useMemo(() => {
    if (competitionDraftTeams.A.length > 0 || competitionDraftTeams.B.length > 0) {
      return competitionDraftTeams;
    }
    return {
      A: competitionSplitPreview.teamA.map((stat) => stat.member),
      B: competitionSplitPreview.teamB.map((stat) => stat.member),
    };
  }, [competitionDraftTeams, competitionSplitPreview]);
  const competitionTeamRatings = useMemo(() => {
    const getRating = (member: Member) => stats.find((stat) => stat.member.id === member.id)?.rating ?? 0;
    return {
      A: activeCompetitionTeams.A.reduce((sum, member) => sum + getRating(member), 0),
      B: activeCompetitionTeams.B.reduce((sum, member) => sum + getRating(member), 0),
    };
  }, [activeCompetitionTeams, stats]);
  const groupedCompetitionRecords = useMemo(() => {
    return competitionRecords.reduce<Record<string, CompetitionRecord[]>>((acc, record) => {
      const year = record.date.slice(0, 4);
      if (!acc[year]) acc[year] = [];
      acc[year].push(record);
      return acc;
    }, {});
  }, [competitionRecords]);

  function handleCompetitionRecalculate() {
    const split = competitionSplitPreview;
    setCompetitionDraftTeams({
      A: split.teamA.map((stat) => stat.member),
      B: split.teamB.map((stat) => stat.member),
    });
    setIsCompetitionEditing(false);
    setIsCompetitionStarted(false);
  }

  function handleCompetitionTeamSwap(member: Member, target: "A" | "B") {
    setCompetitionDraftTeams((current) => {
      if (target === "A") {
        return {
          A: [...current.A.filter((item) => item.id !== member.id), member],
          B: current.B.filter((item) => item.id !== member.id),
        };
      }
      return {
        A: current.A.filter((item) => item.id !== member.id),
        B: [...current.B.filter((item) => item.id !== member.id), member],
      };
    });
  }

  async function handleAddMember(event?: FormEvent<HTMLFormElement>) {
    if (event) event.preventDefault();
    const trimmedName = newMemberName.trim();
    console.info("[members] add-member start", { trimmedName });

    if (!trimmedName) {
      setStatusMessage("メンバー名を入力してください。");
      return;
    }

    const client: any = getSupabaseClient();
    console.info("[members] client ready", { hasClient: Boolean(client) });
    if (!client) {
      setStatusMessage("Supabaseの接続設定がないため、保存できません。" );
      return;
    }

    setLoading(true);
    try {
      console.info("[members] insert request", { table: "members", name: trimmedName });
      const { data, error } = await client
        .from("members")
        .insert([{ name: trimmedName }])
        .select("*")
        .single();

      const insertedMember = (data as Member | null) ?? null;
      console.info("[members] insert response", { data: insertedMember, error });

      if (error) {
        console.error("member insert error:", {
          message: error.message,
          code: error.code,
          details: error.details,
          hint: error.hint,
        });
        let display = `メンバー登録エラー: ${error.message}`;
        const lower = (error.message ?? "").toLowerCase();
        if (lower.includes("policy") || lower.includes("rls") || lower.includes("permission") || lower.includes("forbidden") || lower.includes("not authenticated")) {
          display += " — SupabaseのRLSまたはPolicy設定が原因で登録できない可能性があります。設定を確認してください。";
        }
        setStatusMessage(display);
        return;
      }

      const { data: storedMembers, error: refetchError } = await client.from("members").select("*").order("created_at", { ascending: true });
      console.info("[members] refetch response", { storedMembers, refetchError });
      if (refetchError) {
        console.error("member refetch error:", {
          message: refetchError.message,
          code: refetchError.code,
          details: refetchError.details,
          hint: refetchError.hint,
        });
        setStatusMessage(`メンバー一覧更新エラー: ${refetchError.message}`);
        return;
      }

      setMembers((storedMembers ?? []) as Member[]);
      if (insertedMember?.id) {
        setSelectedMemberIds((prev) => (prev.includes(insertedMember.id) ? prev : [...prev, insertedMember.id]));
      }
      setNewMemberName("");
      setIsMemberComposerOpen(false);
      setStatusMessage("メンバーを追加しました。");
    } catch (caughtError) {
      console.error("member insert thrown error:", caughtError);
      const message = caughtError instanceof Error ? caughtError.message : String(caughtError);
      setStatusMessage(`メンバー登録エラー: ${message}`);
    } finally {
      setLoading(false);
    }
  }

  async function refreshMembers() {
    const client: any = getSupabaseClient();
    if (!client) {
      setStatusMessage("Supabaseの接続設定がないため、保存できません。");
      return;
    }
    const { data, error } = await client.from("members").select("*").order("created_at", { ascending: true });
    if (error) {
      console.error("fetch members error:", {
        message: error.message,
        code: error.code,
        details: error.details,
        hint: error.hint,
      });
      setStatusMessage(`データ取得エラー: ${error.message}`);
      return;
    }
    setMembers((data ?? []) as Member[]);
  }

  async function handleDeleteMember(memberId: string) {
    const client: any = getSupabaseClient();
    if (!client) {
      setStatusMessage("Supabaseの接続設定がないため、削除できません。");
      return;
    }
    const { error } = await client.from("members").delete().eq("id", memberId);
    if (error) {
      console.error("delete member error:", {
        message: error.message,
        code: error.code,
        details: error.details,
        hint: error.hint,
      });
      setStatusMessage(`メンバー削除エラー: ${error.message}`);
      return;
    }
    await refreshMembers();
    setStatusMessage("メンバーを削除しました。");
  }

  async function handleUpdateMemberName(memberId: string) {
    const trimmed = editMemberName.trim();
    if (!trimmed) {
      setStatusMessage("メンバー名を入力してください。");
      return;
    }
    const client: any = getSupabaseClient();
    if (!client) {
      setStatusMessage("Supabaseの接続設定がないため、更新できません。");
      return;
    }
    const { error } = await client.from("members").update({ name: trimmed }).eq("id", memberId);
    if (error) {
      console.error("update member error:", {
        message: error.message,
        code: error.code,
        details: error.details,
        hint: error.hint,
      });
      setStatusMessage(`メンバー更新エラー: ${error.message}`);
      return;
    }
    setEditMemberId(null);
    setEditMemberName("");
    await refreshMembers();
    setStatusMessage("メンバー名を更新しました。");
  }

  async function handleSaveScores(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const client: any = getSupabaseClient();
    if (!client) {
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

      const { data: existingRounds, error: existingError } = await client
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
        const { error: updateError } = await client.from("rounds").update({ score: scoreValue }).eq("id", existingRound.id);
        if (updateError) {
          setLoading(false);
          setStatusMessage("スコア更新に失敗しました。");
          console.error(updateError);
          return;
        }
      } else {
        const { error: insertError } = await client.from("rounds").insert([
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
    if (isCompetitionMode) {
      const teamScores = {
        A: activeCompetitionTeams.A.reduce((sum, member) => sum + Number(competitionScoreDrafts[member.id] ?? 0), 0),
        B: activeCompetitionTeams.B.reduce((sum, member) => sum + Number(competitionScoreDrafts[member.id] ?? 0), 0),
      };
      const winner = teamScores.A === teamScores.B ? "draw" : teamScores.A < teamScores.B ? "B" : "A";
      const nextRecord: CompetitionRecord = {
        id: `${Date.now()}`,
        date: newRound.playedAt,
        courseName: newRound.courseName.trim() || "未指定",
        teams: {
          A: activeCompetitionTeams.A.map((member) => ({
            memberId: member.id,
            memberName: member.name,
            score: Number(competitionScoreDrafts[member.id] ?? 0),
            rating: stats.find((stat) => stat.member.id === member.id)?.rating ?? 0,
          })),
          B: activeCompetitionTeams.B.map((member) => ({
            memberId: member.id,
            memberName: member.name,
            score: Number(competitionScoreDrafts[member.id] ?? 0),
            rating: stats.find((stat) => stat.member.id === member.id)?.rating ?? 0,
          })),
        },
        teamScores,
        winner,
      };
      const nextRecords = [nextRecord, ...competitionRecords];
      setCompetitionRecords(nextRecords);
      const { error: competitionError } = await client.from("settings").upsert([
        { key: "competitions", value: JSON.stringify(nextRecords) },
      ]);
      if (competitionError) {
        setStatusMessage("コンペ記録の保存に失敗しました。")
        console.error(competitionError);
        return;
      }
    }

    setStatusMessage("スコアを保存しました。");
    const { data: storedRounds } = await client.from("rounds").select("*").order("played_at", { ascending: false });
    setRounds((storedRounds ?? []) as Round[]);
    setScoreDrafts({});
    setCompetitionScoreDrafts({});
    setNewRound({ courseName: "", playedAt: defaultPlayedAt });
  }

  async function handleSaveChampionshipResult(memberId: string, result: ChampionshipResult) {
    const client: any = getSupabaseClient();
    if (!client) {
      setStatusMessage("Supabaseの接続設定がないため、保存できません。");
      return;
    }

    const nextResults = {
      ...championshipResults,
      [memberId]: result,
    };

    setChampionshipResults(nextResults);
    const { error } = await client.from("settings").upsert([
      { key: "championship_results", value: JSON.stringify(nextResults) },
    ]);

    if (error) {
      setStatusMessage("大会結果の保存に失敗しました。");
      console.error(error);
      return;
    }

    setStatusMessage("大会結果を保存しました。");
  }

  async function handleSaveCompetitionRecord() {
    const client: any = getSupabaseClient();
    if (!client) {
      setStatusMessage("Supabaseの接続設定がないため、保存できません。");
      return;
    }

    const nextRecord: CompetitionRecord = {
      id: `${Date.now()}`,
      date: newRound.playedAt,
      courseName: newRound.courseName.trim() || "未指定",
      teams: {
        A: selectedMemberDetails.slice(0, Math.ceil(selectedMemberDetails.length / 2)).map((stat) => ({
          memberId: stat.member.id,
          memberName: stat.member.name,
          score: 0,
          rating: stat.rating,
        })),
        B: selectedMemberDetails.slice(Math.ceil(selectedMemberDetails.length / 2)).map((stat) => ({
          memberId: stat.member.id,
          memberName: stat.member.name,
          score: 0,
          rating: stat.rating,
        })),
      },
      teamScores: { A: 0, B: 0 },
      teamTotals: { A: 0, B: 0 },
      scoreTotals: { A: 0, B: 0 },
      winner: "draw",
    };

    const nextRecords = [nextRecord, ...competitionRecords];
    setCompetitionRecords(nextRecords);
    const { error } = await client.from("settings").upsert([
      { key: "competitions", value: JSON.stringify(nextRecords) },
    ]);

    if (error) {
      setStatusMessage("コンペ記録の保存に失敗しました。");
      console.error(error);
      return;
    }

    setStatusMessage("コンペ記録を保存しました。");
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
                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setIsCompetitionMode((current) => !current)}
                      className={`h-11 whitespace-nowrap rounded-full border px-3 text-[13px] font-semibold ${isCompetitionMode ? "border-[#16a34a] bg-[#f0fdf4] text-[#166534]" : "border-[#d1d5db] bg-white text-[#111111]"}`}
                    >
                      南高コンペ {isCompetitionMode ? "ON" : "OFF"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsEditMembersMode((current) => !current)}
                      className="h-11 whitespace-nowrap rounded-full border border-[#d1d5db] px-4 text-sm font-semibold text-[#111111]"
                    >
                      {isEditMembersMode ? "完了" : "編集"}
                    </button>
                  </div>
                </div>

                <div className="mt-5 space-y-4">
                  <form onSubmit={handleSaveScores} className="space-y-4">
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

                  {isCompetitionMode ? (
                    <div className="rounded-[24px] border border-[#e5e7eb] bg-[#f8fff8] p-3">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <p className="text-sm font-semibold text-[#111111]">自動チーム分け</p>
                          <p className="mt-1 text-xs text-[#6b7280]">レート差が小さくなるように分けます。</p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <button type="button" onClick={() => setIsCompetitionEditing((current) => !current)} className="h-10 whitespace-nowrap rounded-full border border-[#d1d5db] bg-white px-3 text-[13px] font-semibold text-[#111111]">編集</button>
                          <button type="button" onClick={handleCompetitionRecalculate} className="h-10 whitespace-nowrap rounded-full bg-[#b91c1c] px-3 text-[13px] font-semibold text-white">再計算</button>
                          <button type="button" onClick={() => setIsCompetitionStarted(true)} className="h-10 whitespace-nowrap rounded-full bg-[#16a34a] px-3 text-[13px] font-semibold text-white">試合開始</button>
                        </div>
                      </div>

                      <div className="mt-3 grid gap-2 sm:grid-cols-2">
                        <div className="rounded-[16px] border border-[#e5e7eb] bg-white p-3">
                          <p className="text-sm font-semibold text-[#111111]">Team A</p>
                          <p className="mt-1 text-xs text-[#6b7280]">合計レート {competitionTeamRatings.A}</p>
                          <div className="mt-2 space-y-2">
                            {activeCompetitionTeams.A.map((member) => (
                              <div key={member.id} className="flex items-center justify-between gap-2 rounded-[12px] border border-[#e5e7eb] bg-[#fafafa] px-2 py-2">
                                <span className="text-sm text-[#111111]">{member.name}</span>
                                {isCompetitionEditing ? (
                                  <button type="button" onClick={() => handleCompetitionTeamSwap(member, "A")} className="rounded-full border border-[#d1d5db] px-2 py-1 text-[12px] font-semibold text-[#111111]">→B</button>
                                ) : null}
                              </div>
                            ))}
                          </div>
                        </div>
                        <div className="rounded-[16px] border border-[#e5e7eb] bg-white p-3">
                          <p className="text-sm font-semibold text-[#111111]">Team B</p>
                          <p className="mt-1 text-xs text-[#6b7280]">合計レート {competitionTeamRatings.B}</p>
                          <div className="mt-2 space-y-2">
                            {activeCompetitionTeams.B.map((member) => (
                              <div key={member.id} className="flex items-center justify-between gap-2 rounded-[12px] border border-[#e5e7eb] bg-[#fafafa] px-2 py-2">
                                <span className="text-sm text-[#111111]">{member.name}</span>
                                {isCompetitionEditing ? (
                                  <button type="button" onClick={() => handleCompetitionTeamSwap(member, "B")} className="rounded-full border border-[#d1d5db] px-2 py-1 text-[12px] font-semibold text-[#111111]">→A</button>
                                ) : null}
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>

                      <div className="mt-3 rounded-[16px] border border-[#e5e7eb] bg-white p-3 text-sm text-[#111111]">
                        <p>Team A合計レート: {competitionTeamRatings.A}</p>
                        <p className="mt-1">Team B合計レート: {competitionTeamRatings.B}</p>
                        <p className="mt-1">レート差: {Math.abs(competitionTeamRatings.A - competitionTeamRatings.B)}</p>
                      </div>

                      {isCompetitionStarted ? (
                        <div className="mt-3 grid gap-2 sm:grid-cols-2">
                          <div className="rounded-[16px] border border-[#e5e7eb] bg-white p-3">
                            <p className="text-sm font-semibold text-[#111111]">Team A スコア</p>
                            <div className="mt-2 space-y-2">
                              {activeCompetitionTeams.A.map((member) => (
                                <label key={member.id} className="block text-sm text-[#111111]">
                                  <span className="mb-1 block">{member.name}</span>
                                  <input
                                    type="text"
                                    inputMode="numeric"
                                    value={competitionScoreDrafts[member.id] ?? ""}
                                    onChange={(event) => setCompetitionScoreDrafts((current) => ({ ...current, [member.id]: event.target.value }))}
                                    className="h-[42px] w-full rounded-[12px] border border-[#d1d5db] bg-[#f9fafb] px-3 text-[16px] text-[#111111]"
                                  />
                                </label>
                              ))}
                            </div>
                          </div>
                          <div className="rounded-[16px] border border-[#e5e7eb] bg-white p-3">
                            <p className="text-sm font-semibold text-[#111111]">Team B スコア</p>
                            <div className="mt-2 space-y-2">
                              {activeCompetitionTeams.B.map((member) => (
                                <label key={member.id} className="block text-sm text-[#111111]">
                                  <span className="mb-1 block">{member.name}</span>
                                  <input
                                    type="text"
                                    inputMode="numeric"
                                    value={competitionScoreDrafts[member.id] ?? ""}
                                    onChange={(event) => setCompetitionScoreDrafts((current) => ({ ...current, [member.id]: event.target.value }))}
                                    className="h-[42px] w-full rounded-[12px] border border-[#d1d5db] bg-[#f9fafb] px-3 text-[16px] text-[#111111]"
                                  />
                                </label>
                              ))}
                            </div>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  <div className="rounded-[24px] border border-[#e5e7eb] bg-[#fafafa] p-3">
                    <div className="mb-3 flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-[#111111]">メンバー</p>
                        <p className="text-xs text-[#6b7280]">複数選択してスコアを入力できます。</p>
                      </div>
                      <div className="flex shrink-0 flex-nowrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setIsEditMembersMode((current) => !current)}
                          className="flex h-11 min-w-[56px] items-center justify-center whitespace-nowrap rounded-full border border-[#d1d5db] bg-white px-3 text-[13px] font-semibold text-[#111111]"
                        >
                          編集
                        </button>
                        <button
                          type="button"
                          onClick={() => setIsMemberComposerOpen((open) => !open)}
                          className="flex h-11 min-w-[44px] items-center justify-center rounded-full bg-[#111111] px-3 text-lg font-semibold text-white"
                        >
                          +
                        </button>
                      </div>
                    </div>

                    {isMemberComposerOpen ? (
                      <div className="mb-3 space-y-2 rounded-[18px] border border-[#e5e7eb] bg-white p-3">
                        <input
                          value={newMemberName}
                          onChange={(event) => setNewMemberName(event.target.value)}
                          placeholder="新しいメンバー名"
                          className="h-[44px] w-full rounded-[14px] border border-[#d1d5db] bg-[#f9fafb] px-3 text-[16px] text-[#111111] outline-none focus:border-[#b91c1c]"
                        />
                        <button type="button" onClick={() => handleAddMember()} className="h-[44px] w-full rounded-[14px] bg-[#b91c1c] text-sm font-semibold text-white">
                          登録する
                        </button>
                      </div>
                    ) : null}

                    {isEditMembersMode ? (
                      <div className="space-y-2">
                        {members.map((member) => (
                          <div key={member.id} className="flex items-center justify-between rounded-[16px] border border-[#e5e7eb] bg-white px-3 py-2">
                            <div className="flex-1">
                              {editMemberId === member.id ? (
                                <input
                                  value={editMemberName}
                                  onChange={(event) => setEditMemberName(event.target.value)}
                                  className="h-10 w-full rounded-[12px] border border-[#d1d5db] px-3 text-[16px] text-[#111111]"
                                />
                              ) : (
                                <span className="text-sm font-semibold text-[#111111]">{member.name}</span>
                              )}
                            </div>
                            <div className="ml-3 flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => {
                                  if (editMemberId === member.id) {
                                    handleUpdateMemberName(member.id);
                                  } else {
                                    setEditMemberId(member.id);
                                    setEditMemberName(member.name);
                                  }
                                }}
                                className="flex h-11 min-w-[44px] items-center justify-center rounded-full border border-[#d1d5db] px-3 text-lg"
                              >
                                ✎
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  if (window.confirm("このメンバーを削除しますか？")) {
                                    handleDeleteMember(member.id);
                                  }
                                }}
                                className="flex h-11 min-w-[44px] items-center justify-center rounded-full bg-[#b91c1c] px-3 text-lg font-semibold text-white"
                              >
                                −
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
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
                    )}
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
                </div>
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
                            <div className="min-w-[132px] text-right">
                              <p className="text-[13px] font-semibold leading-5 text-[#b91c1c]">🏆 ベストスコア</p>
                              <p className="mt-1 text-sm font-semibold text-[#111111]">{group.minScore}</p>
                              <p className="mt-1 text-[12px] text-[#6b7280]">{group.minMemberName || "-"}</p>
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
          ) : activeTab === "tier" ? (
            <div className="space-y-4">
              <section className="rounded-[28px] border border-[#e7e5e4] bg-white p-4 shadow-sm">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-[18px] font-semibold text-[#111111]">Tier表</h2>
                    <p className="mt-1 text-sm text-[#6b7280]">レート点数に応じてS〜Cで分類します。</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setExpandedDetail((current) => (current === "tier" ? null : "tier"))}
                    className="rounded-full bg-[#111111] whitespace-nowrap min-w-[56px] h-11 px-4 text-sm flex items-center justify-center flex-shrink-0 font-semibold text-white"
                  >
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
                  <button
                    type="button"
                    onClick={() => setExpandedDetail((current) => (current === "ranking" ? null : "ranking"))}
                    className="rounded-full bg-[#111111] whitespace-nowrap min-w-[56px] h-11 px-4 text-sm flex items-center justify-center flex-shrink-0 font-semibold text-white"
                  >
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

            </div>
          ) : (
            <div className="space-y-4">
              <section className="rounded-[28px] border border-[#e7e5e4] bg-white p-4 shadow-sm">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-[18px] font-semibold text-[#111111]">結果</h2>
                    <p className="mt-1 text-sm text-[#6b7280]">大会結果とコンペモードの記録をまとめて確認できます。</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsCompetitionMode((current) => !current)}
                    className="h-11 whitespace-nowrap rounded-full bg-[#111111] px-4 text-sm font-semibold text-white"
                  >
                    {isCompetitionMode ? "閉じる" : "コンペ開始"}
                  </button>
                </div>

                <div className="mt-4 space-y-3">
                  <div className="rounded-[20px] border border-[#e5e7eb] bg-[#fafafa] p-3">
                    <p className="text-sm font-semibold text-[#111111]">大会結果</p>
                    {competitionRecords.length === 0 ? (
                      <p className="mt-2 text-sm text-[#6b7280]">まだ大会結果がありません。</p>
                    ) : (
                      <div className="mt-3 space-y-3">
                        {Object.entries(groupedCompetitionRecords)
                          .sort(([a], [b]) => Number(b) - Number(a))
                          .map(([year, records]) => {
                            const isOpen = expandedCompetitionYear === year;
                            return (
                              <div key={year} className="rounded-[16px] border border-[#e5e7eb] bg-white p-3">
                                <button type="button" onClick={() => setExpandedCompetitionYear(isOpen ? null : year)} className="flex w-full items-center justify-between gap-3 text-left">
                                  <span className="text-sm font-semibold text-[#111111]">{year}年</span>
                                  <span className="rounded-full bg-[#111111] px-3 py-1 text-[12px] font-semibold text-white">{records.length}件</span>
                                </button>
                                {isOpen ? (
                                  <div className="mt-3 space-y-2">
                                    {records.slice().sort((a, b) => b.date.localeCompare(a.date)).map((record) => {
                                      const rankLabel = record.winner === "A" ? "優勝" : record.winner === "B" ? "準優勝" : "引き分け";
                                      const rankBadgeClass = record.winner === "A" ? "bg-[#fef3c7] text-[#92400e]" : record.winner === "B" ? "bg-[#e5e7eb] text-[#374151]" : "bg-[#f3f4f6] text-[#111111]";
                                      return (
                                        <div key={record.id} className="rounded-[14px] border border-[#e5e7eb] bg-[#fafafa] p-3">
                                          <div className="flex items-center justify-between gap-2">
                                            <div>
                                              <p className="text-sm font-semibold text-[#111111]">{record.courseName}</p>
                                              <p className="mt-1 text-[12px] text-[#6b7280]">{record.date}</p>
                                            </div>
                                            <span className={`rounded-full px-2 py-1 text-[12px] font-semibold ${rankBadgeClass}`}>{rankLabel}</span>
                                          </div>
                                          <div className="mt-2 grid gap-2 text-sm text-[#111111] sm:grid-cols-2">
                                            <div className="rounded-[12px] border border-[#e5e7eb] bg-white p-2">
                                              <p className="font-semibold">Team A</p>
                                              <p className="mt-1">合計 {record.teamScores.A}</p>
                                              {record.teams.A.map((entry) => <p key={entry.memberId} className="mt-1 text-[#6b7280]">{entry.memberName}: {entry.score}</p>)}
                                            </div>
                                            <div className="rounded-[12px] border border-[#e5e7eb] bg-white p-2">
                                              <p className="font-semibold">Team B</p>
                                              <p className="mt-1">合計 {record.teamScores.B}</p>
                                              {record.teams.B.map((entry) => <p key={entry.memberId} className="mt-1 text-[#6b7280]">{entry.memberName}: {entry.score}</p>)}
                                            </div>
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                ) : null}
                              </div>
                            );
                          })}
                      </div>
                    )}
                  </div>

                  <div className="rounded-[20px] border border-[#e5e7eb] bg-[#fafafa] p-3">
                    <p className="text-sm font-semibold text-[#111111]">コンペモード</p>
                    <p className="mt-1 text-sm text-[#6b7280]">A/Bチームの組み合わせを見ながら、試合結果を残せるようにします。</p>
                    {isCompetitionMode ? (
                      <div className="mt-3 space-y-2">
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
                        <div className="grid gap-2 sm:grid-cols-2">
                          <div className="rounded-[16px] border border-[#e5e7eb] bg-white p-3">
                            <p className="text-sm font-semibold text-[#111111]">Team A</p>
                            {selectedMemberDetails.slice(0, Math.ceil(selectedMemberDetails.length / 2)).map((stat) => (
                              <p key={stat.member.id} className="mt-2 text-sm text-[#111111]">{stat.member.name}</p>
                            ))}
                          </div>
                          <div className="rounded-[16px] border border-[#e5e7eb] bg-white p-3">
                            <p className="text-sm font-semibold text-[#111111]">Team B</p>
                            {selectedMemberDetails.slice(Math.ceil(selectedMemberDetails.length / 2)).map((stat) => (
                              <p key={stat.member.id} className="mt-2 text-sm text-[#111111]">{stat.member.name}</p>
                            ))}
                          </div>
                        </div>
                        <button type="button" onClick={handleSaveCompetitionRecord} className="mt-3 h-[44px] w-full rounded-[16px] bg-[#b91c1c] text-sm font-semibold text-white">
                          記録として保存する
                        </button>
                      </div>
                    ) : (
                      <p className="mt-3 text-sm text-[#6b7280]">トグルを押すと、参加メンバーでチームの見立てを確認できます。</p>
                    )}
                  </div>

                  <div className="rounded-[20px] border border-[#e5e7eb] bg-[#fafafa] p-3">
                    <p className="text-sm font-semibold text-[#111111]">保存済みコンペ記録</p>
                    {competitionRecords.length === 0 ? (
                      <p className="mt-2 text-sm text-[#6b7280]">まだ記録がありません。</p>
                    ) : (
                      <div className="mt-3 space-y-2">
                        {competitionRecords.slice(0, 3).map((record) => (
                          <div key={record.id} className="rounded-[16px] border border-[#e5e7eb] bg-white px-3 py-2 text-sm text-[#111111]">
                            <p className="font-semibold">{record.courseName} · {record.date}</p>
                            <p className="mt-1 text-[#6b7280]">A {record.teamScores.A} / B {record.teamScores.B}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
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
          <button type="button" onClick={() => setActiveTab("results")} className={`flex-1 rounded-[16px] px-3 py-3 text-sm font-semibold ${activeTab === "results" ? "bg-[#fef2f2] text-[#b91c1c]" : "bg-[#1f1f1f] text-[#f5e8e8]"}`}>
            結果
          </button>
        </div>
      </nav>
    </div>
  );
}
