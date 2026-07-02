import jenkins.model.*
import hudson.security.*
import jenkins.install.InstallState

def instance = Jenkins.getInstance()
def env = System.getenv()

def adminUser = env.getOrDefault("JENKINS_ADMIN_USER", "admin")
def adminPassword = env.getOrDefault("JENKINS_ADMIN_PASSWORD", "admin")

// 确保安装状态已完成
instance.setInstallState(InstallState.INITIAL_SETUP_COMPLETED)

// 创建或获取安全域
def hudsonRealm = instance.getSecurityRealm()
if (!(hudsonRealm instanceof HudsonPrivateSecurityRealm)) {
    hudsonRealm = new HudsonPrivateSecurityRealm(false)
    instance.setSecurityRealm(hudsonRealm)
}

// 创建或更新管理员用户
def user = hudsonRealm.getUser(adminUser)
if (user == null) {
    user = hudsonRealm.createAccount(adminUser, adminPassword)
} else {
    def oldDetails = user.getProperty(hudson.security.HudsonPrivateSecurityRealm.Details.class)
    if (oldDetails != null) {
        user.getProperties().remove(oldDetails)
    }
    user.addProperty(hudson.security.HudsonPrivateSecurityRealm.Details.fromPlainPassword(adminPassword))
}
user.save()

// 配置权限策略
def strategy = new FullControlOnceLoggedInAuthorizationStrategy()
strategy.setAllowAnonymousRead(false)
instance.setAuthorizationStrategy(strategy)

instance.save()

println "✅ Jenkins 管理员用户已就绪: ${adminUser}"
