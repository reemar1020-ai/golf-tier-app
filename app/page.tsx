"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
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

type RoundGroupEditDraft = {
  playedAt: string;
  courseName: string;
  scores: Record<string, string>;
};

type CompetitionEditMemberDraft = {
  memberId: string;
  memberName: string;
  rating: number;
  score: string;
  team: "A" | "B";
};

type CompetitionEditDraft = {
  date: string;
  courseName: string;
  members: CompetitionEditMemberDraft[];
};

const defaultPlayedAt = new Date().toISOString().slice(0, 10);

function normalizeMembers(value: unknown): Member[] {
  if (!Array.isArray(value)) return [];
  return value.reduce<Member[]>((acc, item) => {
    if (!item || typeof item !== "object") return acc;
    const candidate = item as Record<string, unknown>;
    const id = typeof candidate.id === "string" ? candidate.id : "";
    const name = typeof candidate.name === "string" ? candidate.name : "";
    const createdAt = typeof candidate.created_at === "string" ? candidate.created_at : "";
    if (!id || !name) return acc;
    acc.push({ id, name, created_at: createdAt });
    return acc;
  }, []);
}

function normalizeRounds(value: unknown): Round[] {
  if (!Array.isArray(value)) return [];
  return value.reduce<Round[]>((acc, item) => {
    if (!item || typeof item !== "object") return acc;
    const candidate = item as Record<string, unknown>;
    const id = typeof candidate.id === "string" ? candidate.id : "";
    const memberId = typeof candidate.member_id === "string" ? candidate.member_id : "";
    const playedAt = typeof candidate.played_at === "string" ? candidate.played_at : "";
    const courseName = typeof candidate.course_name === "string" ? candidate.course_name : "";
    const numericScore = Number(candidate.score);
    const score = Number.isFinite(numericScore) ? numericScore : 0;
    const createdAt = typeof candidate.created_at === "string" ? candidate.created_at : "";
    if (!id || !memberId || !playedAt || !courseName) return acc;
    acc.push({ id, member_id: memberId, played_at: playedAt, course_name: courseName, score, created_at: createdAt });
    return acc;
  }, []);
}

function normalizeCompetitionEntry(value: unknown): CompetitionEntry | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  const memberId = typeof candidate.memberId === "string" ? candidate.memberId : "";
  const memberName = typeof candidate.memberName === "string" ? candidate.memberName : "名前未登録";
  const numericScore = Number(candidate.score);
  const numericRating = Number(candidate.rating);
  return {
    memberId,
    memberName,
    score: Number.isFinite(numericScore) ? numericScore : 0,
    rating: Number.isFinite(numericRating) ? numericRating : 0,
  };
}

function normalizeCompetitionRecord(value: unknown): CompetitionRecord | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  const rawTeams = candidate.teams && typeof candidate.teams === "object" ? (candidate.teams as Record<string, unknown>) : {};
  const rawTeamScores = candidate.teamScores && typeof candidate.teamScores === "object" ? (candidate.teamScores as Record<string, unknown>) : {};
  const rawTeamTotals = candidate.teamTotals && typeof candidate.teamTotals === "object" ? (candidate.teamTotals as Record<string, unknown>) : {};
  const rawScoreTotals = candidate.scoreTotals && typeof candidate.scoreTotals === "object" ? (candidate.scoreTotals as Record<string, unknown>) : {};
  const teamA = Array.isArray(rawTeams.A)
    ? rawTeams.A.map(normalizeCompetitionEntry).filter((item): item is CompetitionEntry => item !== null)
    : [];
  const teamB = Array.isArray(rawTeams.B)
    ? rawTeams.B.map(normalizeCompetitionEntry).filter((item): item is CompetitionEntry => item !== null)
    : [];
  const numericTeamAScore = Number(rawTeamScores.A);
  const numericTeamBScore = Number(rawTeamScores.B);
  const winnerValue = candidate.winner;
  const winner = winnerValue === "A" || winnerValue === "B" || winnerValue === "draw" ? winnerValue : "draw";

  return {
    id: typeof candidate.id === "string" ? candidate.id : `${Date.now()}`,
    date: typeof candidate.date === "string" ? candidate.date : "",
    courseName: typeof candidate.courseName === "string" ? candidate.courseName : "未指定",
    teams: { A: teamA, B: teamB },
    teamScores: {
      A: Number.isFinite(numericTeamAScore) ? numericTeamAScore : 0,
      B: Number.isFinite(numericTeamBScore) ? numericTeamBScore : 0,
    },
    winner,
    teamTotals: {
      A: Number.isFinite(Number(rawTeamTotals.A)) ? Number(rawTeamTotals.A) : 0,
      B: Number.isFinite(Number(rawTeamTotals.B)) ? Number(rawTeamTotals.B) : 0,
    },
    scoreTotals: {
      A: Number.isFinite(Number(rawScoreTotals.A)) ? Number(rawScoreTotals.A) : 0,
      B: Number.isFinite(Number(rawScoreTotals.B)) ? Number(rawScoreTotals.B) : 0,
    },
  };
}

function normalizeCompetitions(value: unknown): CompetitionRecord[] {
  if (Array.isArray(value)) {
    return value.reduce<CompetitionRecord[]>((acc, item) => {
      const normalized = normalizeCompetitionRecord(item);
      if (normalized) acc.push(normalized);
      return acc;
    }, []);
  }

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return normalizeCompetitions(parsed);
    } catch (error) {
      console.error("Results tab render error:", error);
      return [];
    }
  }

  return [];
}

function normalizeChampionshipResults(value: unknown): Record<string, ChampionshipResult> {
  if (typeof value === "string") {
    try {
      return normalizeChampionshipResults(JSON.parse(value));
    } catch (error) {
      console.error("Results tab render error:", error);
      return {};
    }
  }

  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).reduce<Record<string, ChampionshipResult>>((acc, [memberId, result]) => {
      if (result === "win" || result === "runner-up" || result === "third" || result === "none") {
        acc[memberId] = result;
      }
      return acc;
    }, {});
  }

  return {};
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

function calculateRatingBreakdown(rounds: Round[], championshipResult: ChampionshipResult) {
  const recentThreeMonthAverage = getRecentAverage(rounds, 90);
  const recentOneYearAverage = getRecentAverage(rounds, 365);
  const recentBestScore = getBestScore(rounds, 365);

  const recentThreeMonthPoints = getScorePoints(recentThreeMonthAverage);
  const bestScoreBonus =
    recentThreeMonthAverage !== null &&
    recentBestScore !== null &&
    recentBestScore <= recentThreeMonthAverage - 10
      ? 30
      : 0;
  const growthBonus =
    recentThreeMonthAverage !== null &&
    recentOneYearAverage !== null &&
    recentThreeMonthAverage <= recentOneYearAverage - 10
      ? 15
      : 0;
  const clutchBonus =
    championshipResult === "win"
      ? 15
      : championshipResult === "runner-up"
      ? 10
      : championshipResult === "third"
      ? 5
      : 0;

  return {
    recentThreeMonthPoints,
    bestScoreBonus,
    growthBonus,
    clutchBonus,
    total: recentThreeMonthPoints + bestScoreBonus + growthBonus + clutchBonus,
  };
}

function groupRoundsByDateAndCourse(rounds: Round[], members: Member[]) {
  const memberNameById = Object.fromEntries(members.map((member) => [member.id, member.name]));
  const grouped = new Map<string, RoundGroup>();

  rounds.forEach((round) => {
    if (!round || typeof round !== "object") return;
    const key = `${round.played_at || ""}::${round.course_name || ""}`;
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

function getRoundGroupId(date: string, course: string) {
  return `${date}::${course}`;
}

function buildRoundGroupDraft(group: RoundGroup): RoundGroupEditDraft {
  const scores = group.entries.reduce<Record<string, string>>((acc, entry) => {
    acc[entry.memberId] = String(entry.score);
    return acc;
  }, {});
  return {
    playedAt: group.date,
    courseName: group.course,
    scores,
  };
}

function getCompetitionTeamEntries(record: CompetitionRecord, team: "A" | "B") {
  const teamA = Array.isArray(record?.teams?.A) ? record.teams.A : [];
  const teamB = Array.isArray(record?.teams?.B) ? record.teams.B : [];
  return team === "A" ? teamA : teamB;
}

function buildCompetitionEditDraft(record: CompetitionRecord): CompetitionEditDraft {
  const teamA = getCompetitionTeamEntries(record, "A");
  const teamB = getCompetitionTeamEntries(record, "B");
  return {
    date: record.date,
    courseName: record.courseName,
    members: [
      ...teamA.map((entry) => ({
        memberId: entry.memberId,
        memberName: entry.memberName || "名前未登録",
        rating: Number.isFinite(entry.rating) ? entry.rating : 0,
        score: String(entry.score ?? ""),
        team: "A" as const,
      })),
      ...teamB.map((entry) => ({
        memberId: entry.memberId,
        memberName: entry.memberName || "名前未登録",
        rating: Number.isFinite(entry.rating) ? entry.rating : 0,
        score: String(entry.score ?? ""),
        team: "B" as const,
      })),
    ],
  };
}

function getCompetitionDerived(record: CompetitionRecord) {
  const teamA = getCompetitionTeamEntries(record, "A");
  const teamB = getCompetitionTeamEntries(record, "B");
  const scoreA = teamA.reduce((sum, entry) => sum + (Number.isFinite(entry.score) ? entry.score : 0), 0);
  const scoreB = teamB.reduce((sum, entry) => sum + (Number.isFinite(entry.score) ? entry.score : 0), 0);
  const winner: "A" | "B" | "draw" = scoreA === scoreB ? "draw" : scoreA < scoreB ? "A" : "B";

  const allEntries = [...teamA, ...teamB].map((entry) => ({
    ...entry,
    score: Number.isFinite(entry.score) ? entry.score : 0,
  }));
  const sorted = allEntries.slice().sort((a, b) => a.score - b.score);

  const rankByMemberId: Record<string, number> = {};
  let currentRank = 0;
  let previousScore: number | null = null;
  sorted.forEach((entry, index) => {
    if (previousScore === null || entry.score !== previousScore) {
      currentRank = index + 1;
      previousScore = entry.score;
    }
    rankByMemberId[entry.memberId] = currentRank;
  });

  const bestEntry = sorted[0] ?? null;
  return {
    teamA,
    teamB,
    scoreA,
    scoreB,
    winner,
    sorted,
    rankByMemberId,
    bestScore: bestEntry?.score ?? null,
    winnerName: bestEntry?.memberName ?? "-",
  };
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
  const [expandedCompetitionId, setExpandedCompetitionId] = useState<string | null>(null);
  const [editCompetitionId, setEditCompetitionId] = useState<string | null>(null);
  const [competitionEditDrafts, setCompetitionEditDrafts] = useState<Record<string, CompetitionEditDraft>>({});
  const [isCompetitionSettingsSaving, setIsCompetitionSettingsSaving] = useState(false);
  const [isCompetitionSettingsDeleting, setIsCompetitionSettingsDeleting] = useState(false);
  const [editingRoundGroupId, setEditingRoundGroupId] = useState<string | null>(null);
  const [roundGroupDrafts, setRoundGroupDrafts] = useState<Record<string, RoundGroupEditDraft>>({});
  const [showAllRoundHistories, setShowAllRoundHistories] = useState(false);
  const [pendingScrollRoundGroupId, setPendingScrollRoundGroupId] = useState<string | null>(null);
  const [savedToastVisible, setSavedToastVisible] = useState(false);
  const [scrollReturnY, setScrollReturnY] = useState<number | null>(null);
  const roundGroupRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const playerDetailRef = useRef<HTMLElement | null>(null);

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
        setChampionshipResults(normalizeChampionshipResults(setting.value));
      }

      const storedCompetitions = storedSettingsRows.find((row) => {
        const setting = row as { key?: unknown };
        return typeof setting.key === "string" && setting.key === "competitions";
      });
      if (storedCompetitions) {
        const setting = storedCompetitions as { value?: unknown };
        setCompetitionRecords(normalizeCompetitions(setting.value));
      }

      setStatusMessage(null);
    }

    load();
  }, []);

  const [championshipResults, setChampionshipResults] = useState<Record<string, ChampionshipResult>>({});

  const safeMembers = useMemo(() => normalizeMembers(members), [members]);
  const safeRounds = useMemo(() => normalizeRounds(rounds), [rounds]);
  const safeCompetitionRecords = useMemo(() => normalizeCompetitions(competitionRecords), [competitionRecords]);

  const stats = useMemo<MemberStats[]>(() => {
    return safeMembers.map((member) => {
      const memberRounds = safeRounds
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
  }, [safeMembers, safeRounds, championshipResults]);

  const roundGroups = useMemo(() => groupRoundsByDateAndCourse(safeRounds, safeMembers), [safeRounds, safeMembers]);

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
  const sortedCompetitionRecords = useMemo(
    () => safeCompetitionRecords.slice().sort((a, b) => b.date.localeCompare(a.date)),
    [safeCompetitionRecords]
  );
  const roundWinCounts = useMemo(() => {
    const wins: Record<string, number> = {};
    const grouped = new Map<string, Round[]>();
    safeRounds.forEach((round) => {
      const key = `${round.played_at}::${round.course_name}`;
      const existing = grouped.get(key) ?? [];
      existing.push(round);
      grouped.set(key, existing);
    });

    grouped.forEach((groupRounds) => {
      if (groupRounds.length === 0) return;
      const minScore = Math.min(...groupRounds.map((item) => item.score));
      groupRounds
        .filter((item) => item.score === minScore)
        .forEach((winnerRound) => {
          wins[winnerRound.member_id] = (wins[winnerRound.member_id] ?? 0) + 1;
        });
    });
    return wins;
  }, [safeRounds]);
  const competitionWinCounts = useMemo(() => {
    const wins: Record<string, number> = {};
    safeCompetitionRecords.forEach((competition) => {
      const teamA = Array.isArray(competition?.teams?.A) ? competition.teams.A : [];
      const teamB = Array.isArray(competition?.teams?.B) ? competition.teams.B : [];
      if (competition.winner === "A") {
        teamA.forEach((entry) => {
          wins[entry.memberId] = (wins[entry.memberId] ?? 0) + 1;
        });
      }
      if (competition.winner === "B") {
        teamB.forEach((entry) => {
          wins[entry.memberId] = (wins[entry.memberId] ?? 0) + 1;
        });
      }
    });
    return wins;
  }, [safeCompetitionRecords]);

  async function refreshRounds() {
    const client: any = getSupabaseClient();
    if (!client) {
      setStatusMessage("Supabaseの接続設定がないため、保存できません。");
      return false;
    }
    const { data, error } = await client.from("rounds").select("*").order("played_at", { ascending: false });
    if (error) {
      setStatusMessage(`エラー: ${error.message}`);
      return false;
    }
    setRounds((data ?? []) as Round[]);
    return true;
  }

  async function refreshCompetitionRecords() {
    const client: any = getSupabaseClient();
    if (!client) {
      setStatusMessage("Supabaseの接続設定がないため、保存できません。");
      return false;
    }

    const { data: settingRow, error: fetchError } = await client
      .from("settings")
      .select("id, key, value")
      .eq("key", "competitions")
      .maybeSingle();
    if (fetchError) {
      console.error("competition settings update error:", {
        message: fetchError.message,
        code: fetchError.code,
        details: fetchError.details,
        hint: fetchError.hint,
      });
      setStatusMessage(`大会結果の更新に失敗しました: ${fetchError.message}`);
      return false;
    }

    const value = (settingRow as { value?: unknown } | null)?.value;
    setCompetitionRecords(normalizeCompetitions(value));
    return true;
  }

  async function saveCompetitionsToSettings(updatedCompetitions: CompetitionRecord[]) {
    const client: any = getSupabaseClient();
    if (!client) {
      setStatusMessage("Supabaseの接続設定がないため、保存できません。");
      return false;
    }

    const { data: settingRow, error: fetchError } = await client
      .from("settings")
      .select("id, key, value")
      .eq("key", "competitions")
      .maybeSingle();

    if (fetchError) {
      console.error("competition settings update error:", {
        message: fetchError.message,
        code: fetchError.code,
        details: fetchError.details,
        hint: fetchError.hint,
      });
      setStatusMessage(`大会結果の更新に失敗しました: ${fetchError.message}`);
      return false;
    }

    const payload = JSON.stringify(updatedCompetitions);
    if (!settingRow) {
      const { error: insertError } = await client.from("settings").insert([{ key: "competitions", value: payload }]);
      if (insertError) {
        console.error("competition settings update error:", {
          message: insertError.message,
          code: insertError.code,
          details: insertError.details,
          hint: insertError.hint,
        });
        setStatusMessage(`大会結果の更新に失敗しました: ${insertError.message}`);
        return false;
      }
      return true;
    }

    const { error: updateError } = await client
      .from("settings")
      .update({ value: payload })
      .eq("key", "competitions");

    if (updateError) {
      console.error("competition settings update error:", {
        message: updateError.message,
        code: updateError.code,
        details: updateError.details,
        hint: updateError.hint,
      });
      setStatusMessage(`大会結果の更新に失敗しました: ${updateError.message}`);
      return false;
    }

    return true;
  }

  function handleStartCompetitionEdit(record: CompetitionRecord) {
    setCompetitionEditDrafts((current) => ({
      ...current,
      [record.id]: buildCompetitionEditDraft(record),
    }));
    setEditCompetitionId(record.id);
  }

  function handleCancelCompetitionEdit(record: CompetitionRecord) {
    setCompetitionEditDrafts((current) => ({
      ...current,
      [record.id]: buildCompetitionEditDraft(record),
    }));
    setEditCompetitionId(null);
  }

  async function handleSaveCompetitionEdit(record: CompetitionRecord) {
    if (isCompetitionSettingsSaving || isCompetitionSettingsDeleting) return;
    const client: any = getSupabaseClient();
    if (!client) {
      setStatusMessage("Supabaseの接続設定がないため、保存できません。");
      return;
    }

    const draft = competitionEditDrafts[record.id] ?? buildCompetitionEditDraft(record);
    const date = draft.date.trim();
    const courseName = draft.courseName.trim();
    if (!date || !courseName) {
      setStatusMessage("日付とゴルフ場を入力してください。");
      return;
    }

    const members = draft.members.map((item) => ({ ...item, score: item.score.trim() }));
    for (const member of members) {
      if (!member.score || !Number.isFinite(Number(member.score)) || Number(member.score) <= 0) {
        setStatusMessage("各メンバーのスコアを正しく入力してください。");
        return;
      }
    }

    const teamA = members
      .filter((item) => item.team === "A")
      .map((item) => ({ memberId: item.memberId, memberName: item.memberName, rating: item.rating, score: Number(item.score) }));
    const teamB = members
      .filter((item) => item.team === "B")
      .map((item) => ({ memberId: item.memberId, memberName: item.memberName, rating: item.rating, score: Number(item.score) }));

    const teamScores = {
      A: teamA.reduce((sum, item) => sum + item.score, 0),
      B: teamB.reduce((sum, item) => sum + item.score, 0),
    };
    const winner: "A" | "B" | "draw" = teamScores.A === teamScores.B ? "draw" : teamScores.A < teamScores.B ? "A" : "B";

    const nextRecord: CompetitionRecord = {
      ...record,
      date,
      courseName,
      teams: { A: teamA, B: teamB },
      teamScores,
      winner,
    };

    const nextRecords = safeCompetitionRecords.map((item) => (item.id === record.id ? nextRecord : item));
    setIsCompetitionSettingsSaving(true);
    const saved = await saveCompetitionsToSettings(nextRecords);
    if (!saved) {
      setIsCompetitionSettingsSaving(false);
      return;
    }

    const refreshed = await refreshCompetitionRecords();
    setIsCompetitionSettingsSaving(false);
    if (!refreshed) return;
    setEditCompetitionId(null);
    setCompetitionEditDrafts((current) => {
      const next = { ...current };
      delete next[record.id];
      return next;
    });
    setStatusMessage("大会結果を更新しました。");
  }

  async function handleDeleteCompetitionRecord(recordId: string) {
    if (isCompetitionSettingsSaving || isCompetitionSettingsDeleting) return;
    if (!window.confirm("この大会結果を削除しますか？")) {
      return;
    }

    const client: any = getSupabaseClient();
    if (!client) {
      setStatusMessage("Supabaseの接続設定がないため、削除できません。");
      return;
    }

    const nextRecords = safeCompetitionRecords.filter((item) => item.id !== recordId);
    setIsCompetitionSettingsDeleting(true);
    const saved = await saveCompetitionsToSettings(nextRecords);
    if (!saved) {
      setIsCompetitionSettingsDeleting(false);
      return;
    }

    const refreshed = await refreshCompetitionRecords();
    setIsCompetitionSettingsDeleting(false);
    if (!refreshed) return;
    setExpandedCompetitionId((current) => (current === recordId ? null : current));
    setEditCompetitionId((current) => (current === recordId ? null : current));
    setCompetitionEditDrafts((current) => {
      const next = { ...current };
      delete next[recordId];
      return next;
    });
    setStatusMessage("大会結果を削除しました。");
  }

  function handleStartRoundGroupEdit(group: RoundGroup) {
    const groupId = getRoundGroupId(group.date, group.course);
    setRoundGroupDrafts((current) => ({
      ...current,
      [groupId]: buildRoundGroupDraft(group),
    }));
    setEditingRoundGroupId(groupId);
  }

  function handleCancelRoundGroupDraft(group: RoundGroup) {
    const groupId = getRoundGroupId(group.date, group.course);
    setRoundGroupDrafts((current) => ({
      ...current,
      [groupId]: buildRoundGroupDraft(group),
    }));
    setEditingRoundGroupId(null);
  }

  async function handleSaveRoundGroup(group: RoundGroup) {
    const client: any = getSupabaseClient();
    if (!client) {
      setStatusMessage("Supabaseの接続設定がないため、保存できません。");
      return;
    }

    const groupId = getRoundGroupId(group.date, group.course);
    const draft = roundGroupDrafts[groupId] ?? buildRoundGroupDraft(group);
    const playedAt = draft.playedAt.trim();
    const courseName = draft.courseName.trim();

    if (!playedAt || !courseName) {
      setStatusMessage("日付とゴルフ場を入力してください。");
      return;
    }

    for (const entry of group.entries) {
      const scoreText = draft.scores[entry.memberId] ?? "";
      const score = Number(scoreText);
      if (!scoreText.trim() || !Number.isFinite(score) || score <= 0) {
        setStatusMessage("各メンバーのスコアを正しく入力してください。");
        return;
      }

      const { error } = await client
        .from("rounds")
        .update({
          played_at: playedAt,
          course_name: courseName,
          score,
        })
        .eq("member_id", entry.memberId)
        .eq("played_at", group.date)
        .eq("course_name", group.course);

      if (error) {
        console.error("round update/delete error:", error);
        setStatusMessage(`エラー: ${error.message}`);
        return;
      }
    }

    const refreshed = await refreshRounds();
    if (!refreshed) return;
    setEditingRoundGroupId(null);
    setStatusMessage("ラウンド履歴を更新しました。");
  }

  async function handleDeleteRoundGroup(group: RoundGroup) {
    if (!window.confirm("このラウンド履歴を削除しますか？")) {
      return;
    }

    const client: any = getSupabaseClient();
    if (!client) {
      setStatusMessage("Supabaseの接続設定がないため、削除できません。");
      return;
    }

    const { error } = await client
      .from("rounds")
      .delete()
      .eq("played_at", group.date)
      .eq("course_name", group.course);

    if (error) {
      console.error("round update/delete error:", error);
      setStatusMessage(`エラー: ${error.message}`);
      return;
    }

    const refreshed = await refreshRounds();
    if (!refreshed) return;
    setExpandedHistoryId(null);
    setEditingRoundGroupId((current) => (current === getRoundGroupId(group.date, group.course) ? null : current));
    setStatusMessage("ラウンド履歴を削除しました。");
  }

  function handleCompetitionTeamSwap(memberId: string, target: "A" | "B") {
    const member = safeMembers.find((item) => item.id === memberId);
    if (!member) return;
    setCompetitionDraftTeams((current) => {
      const source = current.A.length > 0 || current.B.length > 0 ? current : activeCompetitionTeams;
      const nextA = source.A.filter((item) => item.id !== member.id);
      const nextB = source.B.filter((item) => item.id !== member.id);

      if (target === "A") {
        return {
          A: [...nextA, member],
          B: nextB,
        };
      }

      return {
        A: nextA,
        B: [...nextB, member],
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

    const courseName = newRound.courseName.trim();
    const playedAt = newRound.playedAt.trim();
    if (!courseName || !playedAt) {
      setStatusMessage("ゴルフ場と日付を入力してください。");
      return;
    }

    setLoading(true);

    if (isCompetitionMode) {
      const teamA = activeCompetitionTeams.A;
      const teamB = activeCompetitionTeams.B;
      const competitionMembers = [...teamA, ...teamB];

      if (teamA.length === 0 || teamB.length === 0 || competitionMembers.length === 0) {
        setLoading(false);
        setStatusMessage("チーム未確定のため保存できません。");
        return;
      }

      if (!isCompetitionStarted) {
        setLoading(false);
        setStatusMessage("試合開始後にスコアを入力して保存してください。");
        return;
      }

      const scoreByMemberId: Record<string, number> = {};
      for (const member of competitionMembers) {
        const scoreText = competitionScoreDrafts[member.id] ?? "";
        const scoreValue = Number(scoreText);
        if (!scoreText.trim() || !Number.isFinite(scoreValue) || scoreValue <= 0) {
          setLoading(false);
          setStatusMessage("コンペ参加メンバー全員のスコアを正しく入力してください。");
          return;
        }
        scoreByMemberId[member.id] = scoreValue;
      }

      for (const member of competitionMembers) {
        const scoreValue = scoreByMemberId[member.id];
        const { data: existingRounds, error: existingError } = await client
          .from("rounds")
          .select("*")
          .eq("member_id", member.id)
          .eq("played_at", playedAt)
          .eq("course_name", courseName);

        if (existingError) {
          setLoading(false);
          setStatusMessage("スコア保存中にエラーが発生しました。再度お試しください。");
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
              played_at: playedAt,
              course_name: courseName,
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

      const teamScores = {
        A: teamA.reduce((sum, member) => sum + scoreByMemberId[member.id], 0),
        B: teamB.reduce((sum, member) => sum + scoreByMemberId[member.id], 0),
      };
      const winner = teamScores.A === teamScores.B ? "draw" : teamScores.A < teamScores.B ? "A" : "B";
      const nextRecord: CompetitionRecord = {
        id: `${Date.now()}`,
        date: playedAt,
        courseName,
        teams: {
          A: teamA.map((member) => ({
            memberId: member.id,
            memberName: member.name,
            score: scoreByMemberId[member.id],
            rating: stats.find((stat) => stat.member.id === member.id)?.rating ?? 0,
          })),
          B: teamB.map((member) => ({
            memberId: member.id,
            memberName: member.name,
            score: scoreByMemberId[member.id],
            rating: stats.find((stat) => stat.member.id === member.id)?.rating ?? 0,
          })),
        },
        teamScores,
        winner,
      };
      const nextRecords = [nextRecord, ...competitionRecords];
      setCompetitionRecords(nextRecords);
      const saved = await saveCompetitionsToSettings(nextRecords);
      if (!saved) {
        setLoading(false);
        return;
      }

      await refreshRounds();
      setLoading(false);
      setStatusMessage("スコアを保存しました。");
      setCompetitionScoreDrafts({});
      setScoreDrafts({});
      setIsCompetitionStarted(false);
      setIsCompetitionEditing(false);
      setCompetitionDraftTeams({ A: [], B: [] });
      setNewRound({ courseName: "", playedAt: defaultPlayedAt });
      setActiveTab("results");
      return;
    }

    const selectedMembers = members.filter((member) => selectedMemberIds.includes(member.id));
    if (selectedMembers.length === 0) {
      setLoading(false);
      setStatusMessage("メンバーを選択してください。");
      return;
    }

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
        .eq("played_at", playedAt)
        .eq("course_name", courseName);

      if (existingError) {
        setLoading(false);
        setStatusMessage("スコア保存中にエラーが発生しました。再度お試しください。");
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
            played_at: playedAt,
            course_name: courseName,
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
    await refreshRounds();
    setScoreDrafts({});
    setCompetitionScoreDrafts({});
    setNewRound({ courseName: "", playedAt: defaultPlayedAt });
    setSavedToastVisible(true);
    setPendingScrollRoundGroupId(getRoundGroupId(playedAt, courseName));
    setActiveTab("results");
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
    const saved = await saveCompetitionsToSettings(nextRecords);

    if (!saved) {
      return;
    }

    setStatusMessage("コンペ記録を保存しました。");
  }

  function toggleMemberSelection(memberId: string) {
    setSelectedMemberIds((current) => (current.includes(memberId) ? current.filter((id) => id !== memberId) : [...current, memberId]));
  }

  const selectedMembers = useMemo(() => safeMembers.filter((member) => selectedMemberIds.includes(member.id)), [safeMembers, selectedMemberIds]);
  const selectedMemberDetails = useMemo(() => stats.filter((stat) => selectedMemberIds.includes(stat.member.id)), [stats, selectedMemberIds]);
  const activePlayerDetail = stats.find((stat) => stat.member.id === selectedRankingMemberId) ?? null;
  const visibleRoundGroups = showAllRoundHistories ? roundGroups : roundGroups.slice(0, 3);

  function handleSelectPlayerDetail(memberId: string) {
    if (typeof window !== "undefined") {
      setScrollReturnY(window.scrollY);
    }
    setSelectedRankingMemberId(memberId);
  }

  function handleClosePlayerDetail() {
    setSelectedRankingMemberId(null);
    if (typeof window !== "undefined" && scrollReturnY !== null) {
      window.scrollTo({ top: scrollReturnY, behavior: "smooth" });
    }
    setScrollReturnY(null);
  }

  useEffect(() => {
    if (!savedToastVisible) return;
    const timer = window.setTimeout(() => {
      setSavedToastVisible(false);
    }, 2000);
    return () => window.clearTimeout(timer);
  }, [savedToastVisible]);

  useEffect(() => {
    if (activeTab !== "results" || !pendingScrollRoundGroupId) return;
    const exists = roundGroups.some((group) => getRoundGroupId(group.date, group.course) === pendingScrollRoundGroupId);
    if (!exists) return;

    const topThreeIds = roundGroups.slice(0, 3).map((group) => getRoundGroupId(group.date, group.course));
    if (!topThreeIds.includes(pendingScrollRoundGroupId)) {
      setShowAllRoundHistories(true);
    }

    setExpandedHistoryId(pendingScrollRoundGroupId);
    const node = roundGroupRefs.current[pendingScrollRoundGroupId];
    if (node) {
      window.requestAnimationFrame(() => {
        node.scrollIntoView({ behavior: "smooth", block: "start" });
      });
      setPendingScrollRoundGroupId(null);
    }
  }, [activeTab, pendingScrollRoundGroupId, roundGroups, showAllRoundHistories]);

  useEffect(() => {
    if (!selectedRankingMemberId || !playerDetailRef.current) return;
    window.requestAnimationFrame(() => {
      playerDetailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, [selectedRankingMemberId]);

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
          {savedToastVisible ? (
            <div className="toast-message fixed left-1/2 top-5 z-50 -translate-x-1/2 rounded-full bg-[#111111] px-4 py-2 text-sm font-semibold text-white shadow-lg">
              保存しました
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
                      onClick={() => {
                        setIsCompetitionMode((current) => {
                          const next = !current;
                          if (next) {
                            setSelectedMemberIds(members.map((member) => member.id));
                            setIsCompetitionStarted(false);
                            setCompetitionScoreDrafts({});
                            setCompetitionDraftTeams({ A: [], B: [] });
                          }
                          return next;
                        });
                      }}
                      className={`h-11 whitespace-nowrap rounded-full border px-3 text-[13px] font-semibold ${isCompetitionMode ? "border-[#16a34a] bg-[#f0fdf4] text-[#166534]" : "border-[#d1d5db] bg-white text-[#111111]"}`}
                    >
                      南高コンペ {isCompetitionMode ? "ON" : "OFF"}
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
                          <button type="button" onClick={() => setIsCompetitionEditing((current) => !current)} className="h-11 whitespace-nowrap rounded-full border border-[#d1d5db] bg-white px-3 text-[13px] font-semibold text-[#111111]">{isCompetitionEditing ? "編集完了" : "編集"}</button>
                          <button type="button" onClick={() => setIsCompetitionStarted(true)} className="h-10 whitespace-nowrap rounded-full bg-[#16a34a] px-3 text-[13px] font-semibold text-white">試合開始</button>
                        </div>
                      </div>

                      {isCompetitionEditing ? (
                        <div className="mt-3 space-y-2 rounded-[16px] border border-[#e5e7eb] bg-white p-3">
                          {[...activeCompetitionTeams.A, ...activeCompetitionTeams.B].map((member) => {
                            const rating = stats.find((stat) => stat.member.id === member.id)?.rating ?? 0;
                            const team = activeCompetitionTeams.A.some((item) => item.id === member.id) ? "A" : "B";
                            return (
                              <div key={member.id} className="grid items-center gap-2 rounded-[12px] border border-[#e5e7eb] bg-[#fafafa] p-2 sm:grid-cols-[1fr_auto_130px]">
                                <span className="text-sm font-semibold text-[#111111]">{member.name}</span>
                                <span className="text-sm text-[#6b7280]">{rating}点</span>
                                <select
                                  value={team}
                                  onChange={(event) => handleCompetitionTeamSwap(member.id, event.target.value === "B" ? "B" : "A")}
                                  className="h-11 w-full rounded-[12px] border border-[#d1d5db] bg-white px-3 text-[16px] text-[#111111]"
                                >
                                  <option value="A">Team A</option>
                                  <option value="B">Team B</option>
                                </select>
                              </div>
                            );
                          })}
                        </div>
                      ) : null}

                      <div className="mt-3 grid gap-2 sm:grid-cols-2">
                        <div className="rounded-[16px] border border-[#e5e7eb] bg-white p-3">
                          <p className="text-sm font-semibold text-[#111111]">Team A</p>
                          <p className="mt-1 text-xs text-[#6b7280]">合計レート {competitionTeamRatings.A}</p>
                          <div className="mt-2 space-y-2">
                            {activeCompetitionTeams.A.map((member) => (
                              <div key={member.id} className="flex items-center justify-between gap-2 rounded-[12px] border border-[#e5e7eb] bg-[#fafafa] px-2 py-2">
                                <span className="text-sm text-[#111111]">{member.name}</span>
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
                                    className="h-11 w-full rounded-[12px] border border-[#d1d5db] bg-[#f9fafb] px-3 text-[16px] text-[#111111]"
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
                                    className="h-11 w-full rounded-[12px] border border-[#d1d5db] bg-[#f9fafb] px-3 text-[16px] text-[#111111]"
                                  />
                                </label>
                              ))}
                            </div>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  {!isCompetitionMode ? (
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
                  ) : null}

                  {!isCompetitionMode ? selectedMembers.length > 0 ? (
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
                  ) : null}

                  <button type="submit" className="h-[48px] w-full rounded-[18px] bg-[#111111] text-sm font-semibold text-white">
                    保存する
                  </button>
                </form>
                </div>
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
                      <div
                        key={tier}
                        className={`rounded-[20px] border p-3 ${
                          tier === "S"
                            ? "border-[#eab308] bg-[#fef9c3]"
                            : tier === "A"
                            ? "border-[#fca5a5] bg-[#fee2e2]"
                            : tier === "B"
                            ? "border-[#93c5fd] bg-[#dbeafe]"
                            : "border-[#d1d5db] bg-[#f3f4f6]"
                        }`}
                      >
                        <div className="mb-2 flex items-center justify-between">
                          <p className="text-sm font-semibold text-[#111111]">{tier === "S" ? "👑 Tier S" : `Tier ${tier}`}</p>
                          <span className="rounded-full bg-white/80 px-3 py-1 text-sm font-semibold text-[#111111]">{tierGroups[tier].length}</span>
                        </div>
                        <div className="space-y-2">
                          {tierGroups[tier].length === 0 ? (
                            <p className="text-sm text-[#6b7280]">まだデータがありません。</p>
                          ) : (
                            tierGroups[tier].map((stat) => (
                              <button key={stat.member.id} type="button" onClick={() => handleSelectPlayerDetail(stat.member.id)} className="w-full rounded-[16px] border border-white/70 bg-white p-3 text-left shadow-sm">
                                <div className="flex items-center justify-between gap-2">
                                  <p className="text-sm font-semibold text-[#111111]">{stat.member.name}</p>
                                  <p className="text-sm font-semibold text-[#111111]">{stat.rating}pt</p>
                                </div>
                                <p className="mt-1 text-xs text-[#4b5563]">Tier {stat.tier} / 平均 {stat.averageScore ?? "-"} / ベスト {stat.bestScore ?? "-"}</p>
                              </button>
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
                          <button key={stat.member.id} type="button" onClick={() => handleSelectPlayerDetail(stat.member.id)} className="flex w-full items-center justify-between rounded-[16px] border border-[#e5e7eb] bg-white px-3 py-3 text-left">
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
                          <button key={stat.member.id} type="button" onClick={() => handleSelectPlayerDetail(stat.member.id)} className="flex w-full items-center justify-between rounded-[16px] border border-[#e5e7eb] bg-white px-3 py-3 text-left">
                            <span className="text-sm font-semibold text-[#111111]">{index + 1}. {stat.member.name}</span>
                            <span className="text-sm font-semibold text-[#111111]">{stat.bestScore ?? "-"}</span>
                          </button>
                        ))}
                      </div>
                    </div>

                  </div>
                ) : null}
              </section>

              {activePlayerDetail ? (
                <section ref={playerDetailRef} className="rounded-[28px] border border-[#e7e5e4] bg-white p-4 shadow-sm">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-[#111111]">{activePlayerDetail.member.name}の詳細</p>
                    <button
                      type="button"
                      onClick={handleClosePlayerDetail}
                      className="h-11 min-w-[56px] flex-shrink-0 whitespace-nowrap rounded-full border border-[#d1d5db] bg-white px-3 text-sm font-semibold text-[#111111]"
                    >
                      閉じる
                    </button>
                  </div>
                  {(() => {
                    const breakdown = calculateRatingBreakdown(activePlayerDetail.rounds, championshipResults[activePlayerDetail.member.id] ?? "none");
                    const normalRoundWins = roundWinCounts[activePlayerDetail.member.id] ?? 0;
                    const competitionWins = competitionWinCounts[activePlayerDetail.member.id] ?? 0;
                    return (
                      <div className="mt-3 space-y-2 text-sm text-[#111111]">
                        <div className="rounded-[16px] border border-[#e5e7eb] bg-[#fafafa] p-3">ベストスコア: {activePlayerDetail.bestScore ?? "記録なし"}</div>
                        <div className="rounded-[16px] border border-[#e5e7eb] bg-[#fafafa] p-3">平均スコア: {activePlayerDetail.averageScore ?? "記録なし"}</div>
                        <div className="rounded-[16px] border border-[#e5e7eb] bg-[#fafafa] p-3">レート点数の合計: {activePlayerDetail.rating}pt</div>
                        <div className="rounded-[16px] border border-[#e5e7eb] bg-[#fafafa] p-3">
                          <p className="font-semibold">レート点数の内訳</p>
                          <p className="mt-1">直近3カ月平均による点数: {breakdown.recentThreeMonthPoints}pt</p>
                          <p className="mt-1">ベストスコア加点: {breakdown.bestScoreBonus}pt</p>
                          <p className="mt-1">成長率加点: {breakdown.growthBonus}pt</p>
                          <p className="mt-1">勝負強さ加点: {breakdown.clutchBonus}pt</p>
                          <p className="mt-1 font-semibold">合計点: {breakdown.total}pt</p>
                        </div>
                        <div className="rounded-[16px] border border-[#e5e7eb] bg-[#fafafa] p-3">Tier: {activePlayerDetail.tier}</div>
                        <div className="rounded-[16px] border border-[#e5e7eb] bg-[#fafafa] p-3">通常ラウンド優勝回数: {normalRoundWins}回</div>
                        <div className="rounded-[16px] border border-[#e5e7eb] bg-[#fafafa] p-3">南高コンペ勝利回数: {competitionWins}回</div>
                      </div>
                    );
                  })()}
                </section>
              ) : null}

            </div>
          ) : (
            <div className="space-y-4">
              <section className="rounded-[28px] border border-[#e7e5e4] bg-white p-4 shadow-sm">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-[18px] font-semibold text-[#111111]">結果</h2>
                    <p className="mt-1 text-sm text-[#6b7280]">通常ラウンド履歴と大会結果を確認できます。</p>
                  </div>
                </div>

                <div className="mt-4 space-y-3">
                  {!safeRounds.length && !safeCompetitionRecords.length ? (
                    <div className="rounded-[20px] border border-dashed border-[#d1d5db] p-5 text-sm text-[#6b7280]">
                      まだラウンド履歴または大会結果がありません
                    </div>
                  ) : null}

                  <div className="rounded-[20px] border border-[#e5e7eb] bg-[#fafafa] p-3">
                    <div className="mb-3 flex items-center justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold text-[#111111]">通常ラウンド履歴</p>
                        <p className="mt-1 text-sm text-[#6b7280]">日付とゴルフ場単位でまとめて表示します。</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setShowAllRoundHistories((current) => !current)}
                          className="h-10 min-w-[56px] whitespace-nowrap rounded-full border border-[#d1d5db] bg-white px-3 text-sm font-semibold text-[#111111]"
                        >
                          {showAllRoundHistories ? "閉じる" : "一覧"}
                        </button>
                        <span className="rounded-full bg-[#fef2f2] px-3 py-1 text-sm font-semibold text-[#b91c1c]">{roundGroups.length}</span>
                      </div>
                    </div>
                    {showAllRoundHistories ? <p className="mb-3 text-xs font-semibold text-[#6b7280]">全ラウンド見出し表示</p> : null}

                    {roundGroups.length === 0 ? (
                      <p className="text-sm text-[#6b7280]">まだデータがありません。</p>
                    ) : (
                      <div className="space-y-3">
                        {visibleRoundGroups.map((group) => {
                          const groupId = getRoundGroupId(group.date, group.course);
                          const draft = roundGroupDrafts[groupId] ?? buildRoundGroupDraft(group);
                          const isOpen = expandedHistoryId === groupId;
                          const isEditing = editingRoundGroupId === groupId;

                          return (
                            <div key={groupId} ref={(node) => { roundGroupRefs.current[groupId] = node; }} className="rounded-[18px] border border-[#e5e7eb] bg-white p-2.5">
                              {!isEditing ? (
                                <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(56px,auto)] items-start gap-2">
                                  <button type="button" onClick={() => setExpandedHistoryId(isOpen ? null : groupId)} className="col-span-2 grid gap-1 text-left">
                                    <div className="min-w-0 text-left">
                                      <p className="text-[13px] font-semibold leading-5 text-[#111111]">{formatDate(group.date)}</p>
                                      <p className="mt-0.5 text-[12px] leading-5 text-[#6b7280] line-clamp-1">{group.course}</p>
                                    </div>
                                    <div className="text-left">
                                      <p className="text-[12px] font-semibold leading-5 text-[#b91c1c]">🏆 優勝者</p>
                                      <p className="text-[12px] leading-5 text-[#6b7280]">{group.minMemberName || "-"}（{group.minScore}）</p>
                                    </div>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleStartRoundGroupEdit(group)}
                                    className="h-10 min-w-[56px] flex-shrink-0 whitespace-nowrap rounded-full border border-[#d1d5db] bg-white px-3 text-sm font-semibold text-[#111111]"
                                  >
                                    編集
                                  </button>
                                </div>
                              ) : (
                                <div className="space-y-3">
                                  <label className="block text-sm font-medium text-[#111111]">
                                    ゴルフ場
                                    <input
                                      value={draft.courseName}
                                      onChange={(event) => {
                                        const value = event.target.value;
                                        setRoundGroupDrafts((current) => ({
                                          ...current,
                                          [groupId]: { ...draft, courseName: value },
                                        }));
                                      }}
                                      className="mt-1 h-11 w-full rounded-[12px] border border-[#d1d5db] bg-[#f9fafb] px-3 text-[16px] text-[#111111]"
                                    />
                                  </label>
                                  <label className="block text-sm font-medium text-[#111111]">
                                    日付
                                    <input
                                      type="date"
                                      value={draft.playedAt}
                                      onChange={(event) => {
                                        const value = event.target.value;
                                        setRoundGroupDrafts((current) => ({
                                          ...current,
                                          [groupId]: { ...draft, playedAt: value },
                                        }));
                                      }}
                                      className="mt-1 h-11 w-full rounded-[12px] border border-[#d1d5db] bg-[#f9fafb] px-3 text-[16px] text-[#111111]"
                                    />
                                  </label>

                                  <div className="space-y-2">
                                    {group.entries.map((entry) => (
                                      <label key={`${groupId}-${entry.memberId}`} className="block text-sm text-[#111111]">
                                        <span className="mb-1 block">{entry.memberName || entry.memberId}</span>
                                        <input
                                          type="text"
                                          inputMode="numeric"
                                          value={draft.scores[entry.memberId] ?? ""}
                                          onChange={(event) => {
                                            const value = event.target.value;
                                            setRoundGroupDrafts((current) => ({
                                              ...current,
                                              [groupId]: {
                                                ...draft,
                                                scores: {
                                                  ...draft.scores,
                                                  [entry.memberId]: value,
                                                },
                                              },
                                            }));
                                          }}
                                          className="h-11 w-full rounded-[12px] border border-[#d1d5db] bg-[#f9fafb] px-3 text-[16px] text-[#111111]"
                                        />
                                      </label>
                                    ))}
                                  </div>

                                  <div className="flex flex-wrap gap-2">
                                    <button type="button" onClick={() => handleSaveRoundGroup(group)} className="h-11 rounded-[12px] bg-[#111111] px-4 text-sm font-semibold text-white">保存</button>
                                    <button type="button" onClick={() => handleCancelRoundGroupDraft(group)} className="h-11 rounded-[12px] border border-[#d1d5db] bg-white px-4 text-sm font-semibold text-[#111111]">キャンセル</button>
                                    <button type="button" onClick={() => handleDeleteRoundGroup(group)} className="h-11 rounded-[12px] bg-[#b91c1c] px-4 text-sm font-semibold text-white">ラウンド削除</button>
                                  </div>
                                </div>
                              )}

                              {!isEditing && isOpen ? (
                                <div className="mt-3 space-y-2">
                                  {group.entries
                                    .slice()
                                    .sort((a, b) => a.score - b.score)
                                    .map((entry) => (
                                      <div key={`${groupId}-${entry.memberId}`} className="rounded-[16px] border border-[#e5e7eb] bg-[#fafafa] px-3 py-2 text-center">
                                        <p className="text-sm text-[#111111]">{entry.memberName || entry.memberId}</p>
                                        <p className="mt-1 text-sm font-semibold text-[#111111]">{entry.score}</p>
                                      </div>
                                    ))}
                                </div>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  <div className="rounded-[20px] border border-[#e5e7eb] bg-[#fafafa] p-3">
                    <p className="text-sm font-semibold text-[#111111]">大会結果</p>
                    {safeCompetitionRecords.length === 0 ? (
                      <p className="mt-2 text-sm text-[#6b7280]">まだ大会結果がありません。</p>
                    ) : (
                      <div className="mt-3 space-y-3">
                        {sortedCompetitionRecords.map((record) => {
                          const derived = getCompetitionDerived(record);
                          const isOpen = expandedCompetitionId === record.id;
                          const isEditing = editCompetitionId === record.id;
                          const draft = competitionEditDrafts[record.id] ?? buildCompetitionEditDraft(record);

                          const getRankLabel = (rank: number) => {
                            if (rank === 1) return { text: "優勝", cls: "text-[#b45309]" };
                            if (rank === 2) return { text: "準優勝", cls: "text-[#6b7280]" };
                            if (rank === 3) return { text: "3位", cls: "text-[#92400e]" };
                            return { text: `${rank}位`, cls: "text-[#111111]" };
                          };

                          return (
                            <div key={record.id} className="rounded-[20px] border border-[#e5e7eb] bg-white p-3">
                              <div className="cursor-pointer" onClick={() => setExpandedCompetitionId(isOpen ? null : record.id)}>
                                <div className="text-left">
                                  <p className="text-sm font-semibold text-[#111111]">{formatDate(record.date)}</p>
                                  <p className="mt-1 text-sm text-[#6b7280]">{record.courseName}</p>
                                  <p className="mt-1 text-[13px] font-semibold text-[#b91c1c]">🏆 優勝者: {derived.winnerName}</p>
                                  <p className="mt-1 text-[13px] text-[#111111]">ベストスコア: {derived.bestScore ?? "-"}</p>
                                </div>
                              </div>

                              {isOpen ? (
                                <div className="mt-2 flex justify-end">
                                  <button
                                    type="button"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      isEditing ? handleCancelCompetitionEdit(record) : handleStartCompetitionEdit(record);
                                    }}
                                    className="h-11 min-w-[56px] flex-shrink-0 whitespace-nowrap rounded-full border border-[#d1d5db] bg-white px-3 text-[13px] font-semibold text-[#111111]"
                                  >
                                    {isEditing ? "キャンセル" : "編集"}
                                  </button>
                                </div>
                              ) : null}

                              {isOpen ? (
                                <div className="mt-3 space-y-3" onClick={(event) => event.stopPropagation()}>
                                  {isEditing ? (
                                    <div className="space-y-3 rounded-[16px] border border-[#e5e7eb] bg-[#fafafa] p-3">
                                      <label className="block text-sm font-medium text-[#111111]">
                                        ゴルフ場
                                        <input
                                          value={draft.courseName}
                                          onChange={(event) => {
                                            const value = event.target.value;
                                            setCompetitionEditDrafts((current) => ({
                                              ...current,
                                              [record.id]: { ...draft, courseName: value },
                                            }));
                                          }}
                                          className="mt-1 h-11 w-full rounded-[12px] border border-[#d1d5db] bg-white px-3 text-[16px] text-[#111111]"
                                        />
                                      </label>
                                      <label className="block text-sm font-medium text-[#111111]">
                                        日付
                                        <input
                                          type="date"
                                          value={draft.date}
                                          onChange={(event) => {
                                            const value = event.target.value;
                                            setCompetitionEditDrafts((current) => ({
                                              ...current,
                                              [record.id]: { ...draft, date: value },
                                            }));
                                          }}
                                          className="mt-1 h-11 w-full rounded-[12px] border border-[#d1d5db] bg-white px-3 text-[16px] text-[#111111]"
                                        />
                                      </label>

                                      <div className="space-y-2">
                                        {draft.members.map((member, index) => (
                                          <div key={`${record.id}-${member.memberId}-${index}`} className="grid gap-2 rounded-[12px] border border-[#e5e7eb] bg-white p-2 sm:grid-cols-3">
                                            <p className="text-sm font-semibold text-[#111111]">{member.memberName}</p>
                                            <select
                                              value={member.team}
                                              onChange={(event) => {
                                                const teamValue = event.target.value === "B" ? "B" : "A";
                                                setCompetitionEditDrafts((current) => ({
                                                  ...current,
                                                  [record.id]: {
                                                    ...draft,
                                                    members: draft.members.map((item, itemIndex) =>
                                                      itemIndex === index ? { ...item, team: teamValue } : item
                                                    ),
                                                  },
                                                }));
                                              }}
                                              className="h-11 rounded-[12px] border border-[#d1d5db] bg-[#f9fafb] px-3 text-[16px] text-[#111111]"
                                            >
                                              <option value="A">Team A</option>
                                              <option value="B">Team B</option>
                                            </select>
                                            <input
                                              type="text"
                                              inputMode="numeric"
                                              value={member.score}
                                              onChange={(event) => {
                                                const value = event.target.value;
                                                setCompetitionEditDrafts((current) => ({
                                                  ...current,
                                                  [record.id]: {
                                                    ...draft,
                                                    members: draft.members.map((item, itemIndex) =>
                                                      itemIndex === index ? { ...item, score: value } : item
                                                    ),
                                                  },
                                                }));
                                              }}
                                              className="h-11 rounded-[12px] border border-[#d1d5db] bg-[#f9fafb] px-3 text-[16px] text-[#111111]"
                                              placeholder="スコア"
                                            />
                                          </div>
                                        ))}
                                      </div>

                                      <div className="flex flex-wrap gap-2">
                                        <button type="button" disabled={isCompetitionSettingsSaving || isCompetitionSettingsDeleting} onClick={() => handleSaveCompetitionEdit(record)} className="h-11 rounded-[12px] bg-[#111111] px-4 text-sm font-semibold text-white disabled:opacity-60">保存</button>
                                        <button type="button" onClick={() => handleCancelCompetitionEdit(record)} className="h-11 rounded-[12px] border border-[#d1d5db] bg-white px-4 text-sm font-semibold text-[#111111]">キャンセル</button>
                                        <button type="button" disabled={isCompetitionSettingsSaving || isCompetitionSettingsDeleting} onClick={() => handleDeleteCompetitionRecord(record.id)} className="h-11 rounded-[12px] bg-[#b91c1c] px-4 text-sm font-semibold text-white disabled:opacity-60">大会結果削除</button>
                                      </div>
                                    </div>
                                  ) : (
                                    <>
                                      <div className="grid gap-2 sm:grid-cols-2">
                                        <div className="rounded-[16px] border border-[#e5e7eb] bg-[#fafafa] p-3">
                                          <div className="flex items-center justify-between gap-2">
                                            <p className="text-sm font-semibold text-[#111111]">Team A</p>
                                            <span className="text-[12px] font-semibold text-[#111111]">
                                              {derived.winner === "A" ? "⭐ WINNER" : derived.winner === "draw" ? "DRAW" : "LOSE"}
                                            </span>
                                          </div>
                                          <p className="mt-1 text-sm text-[#6b7280]">チーム合計: {derived.scoreA}</p>
                                          <div className="mt-2 space-y-1">
                                            {derived.teamA.map((entry) => {
                                              const rank = derived.rankByMemberId[entry.memberId] ?? 0;
                                              const rankLabel = getRankLabel(rank);
                                              return (
                                                <div key={`A-${record.id}-${entry.memberId}`} className="flex items-center justify-between rounded-[10px] bg-white px-2 py-2 text-sm">
                                                  <span>{entry.memberName}</span>
                                                  <span className="font-semibold">{entry.score}</span>
                                                  <span className={`text-[12px] font-semibold ${rankLabel.cls}`}>{rankLabel.text}</span>
                                                </div>
                                              );
                                            })}
                                          </div>
                                        </div>

                                        <div className="rounded-[16px] border border-[#e5e7eb] bg-[#fafafa] p-3">
                                          <div className="flex items-center justify-between gap-2">
                                            <p className="text-sm font-semibold text-[#111111]">Team B</p>
                                            <span className="text-[12px] font-semibold text-[#111111]">
                                              {derived.winner === "B" ? "⭐ WINNER" : derived.winner === "draw" ? "DRAW" : "LOSE"}
                                            </span>
                                          </div>
                                          <p className="mt-1 text-sm text-[#6b7280]">チーム合計: {derived.scoreB}</p>
                                          <div className="mt-2 space-y-1">
                                            {derived.teamB.map((entry) => {
                                              const rank = derived.rankByMemberId[entry.memberId] ?? 0;
                                              const rankLabel = getRankLabel(rank);
                                              return (
                                                <div key={`B-${record.id}-${entry.memberId}`} className="flex items-center justify-between rounded-[10px] bg-white px-2 py-2 text-sm">
                                                  <span>{entry.memberName}</span>
                                                  <span className="font-semibold">{entry.score}</span>
                                                  <span className={`text-[12px] font-semibold ${rankLabel.cls}`}>{rankLabel.text}</span>
                                                </div>
                                              );
                                            })}
                                          </div>
                                        </div>
                                      </div>

                                      <div className="rounded-[16px] border border-[#e5e7eb] bg-[#fafafa] p-3">
                                        <p className="text-sm font-semibold text-[#111111]">全体順位</p>
                                        <div className="mt-2 space-y-1">
                                          {derived.sorted.map((entry) => {
                                            const rank = derived.rankByMemberId[entry.memberId] ?? 0;
                                            const rankLabel = getRankLabel(rank);
                                            return (
                                              <div key={`rank-${record.id}-${entry.memberId}`} className="flex items-center justify-between rounded-[10px] bg-white px-2 py-2 text-sm">
                                                <span>{entry.memberName}</span>
                                                <span className="font-semibold">{entry.score}</span>
                                                <span className={`text-[12px] font-semibold ${rankLabel.cls}`}>{rankLabel.text}</span>
                                              </div>
                                            );
                                          })}
                                        </div>
                                      </div>
                                    </>
                                  )}
                                </div>
                              ) : null}
                            </div>
                          );
                        })}
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
