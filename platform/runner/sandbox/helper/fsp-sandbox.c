/*
 * fsp-sandbox — маленький setuid-root помощник runner (только контейнер).
 *
 * Сервис runner работает под непривилегированным uid (RUNNER_UID, 1001) и не может сам сменить uid
 * задания. Этот помощник (владелец root, группа runner, режим 4750 — запускать может только группа
 * runner) делает ровно три вещи и всегда сначала необратимо сбрасывает себя в uid/gid задания
 * (SANDBOX_UID, 2000) — зашитые при сборке, из аргументов не берутся:
 *
 *   fsp-sandbox exec <path> [args...]  — стать uid 2000, PR_SET_NO_NEW_PRIVS, execv(path, args)
 *   fsp-sandbox killall                — стать uid 2000, kill(-1, SIGKILL): все процессы задания
 *   fsp-sandbox clean <dir>            — стать uid 2000, удалить содержимое dir (под /work/jobs/ или /dev/shm)
 *
 * После setresuid(2000,2000,2000) из euid 0 ядро очищает permitted/effective/ambient capabilities
 * (capabilities(7), «Effect of user ID changes on capabilities»), поэтому задание не получает ни одной.
 * В контейнере bounding set ограничен cap_add [SETUID, SETGID]: даже euid 0 здесь умеет только менять
 * uid/gid. Окружение передаёт сервис (уже очищенное); статическая сборка — LD_* не действуют.
 */
#define _GNU_SOURCE
#include <errno.h>
#include <ftw.h>
#include <grp.h>
#include <limits.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/prctl.h>
#include <sys/stat.h>
#include <unistd.h>

#ifndef CALLER_UID
#define CALLER_UID 1001
#endif
#ifndef SANDBOX_UID
#define SANDBOX_UID 2000
#endif
#ifndef SANDBOX_GID
#define SANDBOX_GID 2000
#endif
#define WORK_PREFIX "/work/jobs/"

static void die(const char *what) {
  fprintf(stderr, "fsp-sandbox: %s: %s\n", what, strerror(errno));
  _exit(126);
}

static void drop_to_sandbox(void) {
  if (setgroups(0, NULL) != 0) die("setgroups");
  if (setresgid(SANDBOX_GID, SANDBOX_GID, SANDBOX_GID) != 0) die("setresgid");
  if (setresuid(SANDBOX_UID, SANDBOX_UID, SANDBOX_UID) != 0) die("setresuid");
  uid_t r, e, s;
  gid_t gr, ge, gs;
  if (getresuid(&r, &e, &s) != 0 || r != SANDBOX_UID || e != SANDBOX_UID || s != SANDBOX_UID) die("uid check");
  if (getresgid(&gr, &ge, &gs) != 0 || gr != SANDBOX_GID || ge != SANDBOX_GID || gs != SANDBOX_GID) die("gid check");
  if (setuid(0) == 0 || seteuid(0) == 0) {
    errno = EPERM;
    die("root regained");
  }
  if (prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) != 0) die("no_new_privs");
}

static int open_dirs(const char *path, const struct stat *sb, int type, struct FTW *ftw) {
  (void)sb;
  (void)ftw;
  if (type == FTW_D || type == FTW_DNR) chmod(path, 0700); /* задание могло закрыть свои каталоги */
  return 0;
}

static int remove_entry(const char *path, const struct stat *sb, int type, struct FTW *ftw) {
  (void)sb;
  (void)type;
  if (ftw->level > 0) remove(path);
  return 0;
}

int main(int argc, char **argv) {
  if (getuid() != CALLER_UID) {
    errno = EPERM;
    die("caller is not the runner service");
  }
  if (argc >= 3 && strcmp(argv[1], "exec") == 0) {
    drop_to_sandbox();
    execv(argv[2], &argv[2]);
    die("execv");
  }
  if (argc == 2 && strcmp(argv[1], "killall") == 0) {
    drop_to_sandbox();
    /* kill(-1) — все процессы, которым можно послать сигнал (uid 2000), кроме себя. */
    if (kill(-1, SIGKILL) != 0 && errno != ESRCH) die("kill");
    return 0;
  }
  if (argc == 3 && strcmp(argv[1], "clean") == 0) {
    char real[PATH_MAX];
    if (realpath(argv[2], real) == NULL) die("realpath");
    if (strncmp(real, WORK_PREFIX, strlen(WORK_PREFIX)) != 0 && strcmp(real, "/dev/shm") != 0) {
      errno = EINVAL;
      die("clean outside /work/jobs and /dev/shm");
    }
    drop_to_sandbox();
    nftw(real, open_dirs, 32, FTW_PHYS);
    nftw(real, remove_entry, 32, FTW_PHYS | FTW_DEPTH);
    return 0;
  }
  fprintf(stderr, "usage: fsp-sandbox exec <path> [args...] | killall | clean <dir>\n");
  return 2;
}
