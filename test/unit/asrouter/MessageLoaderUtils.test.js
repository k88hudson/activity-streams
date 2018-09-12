import {GlobalOverrider} from "test/unit/utils";
import {MessageLoaderUtils} from "lib/ASRouter.jsm";
const {STARTPAGE_VERSION} = MessageLoaderUtils;

const FAKE_STORAGE = {
  set() {
    return Promise.resolve();
  },
  get() { return Promise.resolve(); }
};
const FAKE_RESPONSE_HEADERS = {get() {}};

describe("MessageLoaderUtils", () => {
  let fetchStub;
  let clock;

  beforeEach(() => {
    clock = sinon.useFakeTimers();
    fetchStub = sinon.stub(global, "fetch");
  });
  afterEach(() => {
    clock.restore();
    fetchStub.restore();
  });

  describe("#loadMessagesForProvider", () => {
    it("should return messages for a local provider with hardcoded messages", async () => {
      const sourceMessage = {id: "foo"};
      const provider = {id: "provider123", type: "local", messages: [sourceMessage]};

      const result = await MessageLoaderUtils.loadMessagesForProvider(provider, FAKE_STORAGE);

      assert.isArray(result.messages);
      // Does the message have the right properties?
      const [message] = result.messages;
      assert.propertyVal(message, "id", "foo");
      assert.propertyVal(message, "provider", "provider123");
    });
    it("should return messages for remote provider", async () => {
      const sourceMessage = {id: "foo"};
      fetchStub.resolves({ok: true, status: 200, json: () => Promise.resolve({messages: [sourceMessage]}), headers: FAKE_RESPONSE_HEADERS});
      const provider = {id: "provider123", type: "remote", url: "https://foo.com"};

      const result = await MessageLoaderUtils.loadMessagesForProvider(provider, FAKE_STORAGE);
      assert.isArray(result.messages);
      // Does the message have the right properties?
      const [message] = result.messages;
      assert.propertyVal(message, "id", "foo");
      assert.propertyVal(message, "provider", "provider123");
      assert.propertyVal(message, "provider_url", "https://foo.com");
    });
    describe("remote provider HTTP codes", () => {
      const testMessage = {id: "foo"};
      const provider = {id: "provider123", type: "remote", url: "https://foo.com", updateCycleInMs: 300};
      const respJson = {messages: [testMessage]};

      function assertReturnsCorrectMessages(actual) {
        assert.isArray(actual.messages);
        // Does the message have the right properties?
        const [message] = actual.messages;
        assert.propertyVal(message, "id", testMessage.id);
        assert.propertyVal(message, "provider", provider.id);
        assert.propertyVal(message, "provider_url", provider.url);
      }

      it("should return messages for 200 response", async () => {
        fetchStub.resolves({ok: true, status: 200, json: () => Promise.resolve(respJson), headers: FAKE_RESPONSE_HEADERS});
        assertReturnsCorrectMessages(await MessageLoaderUtils.loadMessagesForProvider(provider, FAKE_STORAGE));
      });

      it("should return messages for a 302 response with json", async () => {
        fetchStub.resolves({ok: false, status: 302, json: () => Promise.resolve(respJson), headers: FAKE_RESPONSE_HEADERS});
        assertReturnsCorrectMessages(await MessageLoaderUtils.loadMessagesForProvider(provider, FAKE_STORAGE));
      });

      it("should return an empty array for a 204 response", async () => {
        fetchStub.resolves({ok: true, status: 204, json: () => "", headers: FAKE_RESPONSE_HEADERS});
        const result = await MessageLoaderUtils.loadMessagesForProvider(provider, FAKE_STORAGE);
        assert.deepEqual(result.messages, []);
      });

      it("should return an empty array for a 500 response", async () => {
        fetchStub.resolves({ok: false, status: 500, json: () => "", headers: FAKE_RESPONSE_HEADERS});
        const result = await MessageLoaderUtils.loadMessagesForProvider(provider, FAKE_STORAGE);
        assert.deepEqual(result.messages, []);
      });

      it("should return cached messages for a 304 response", async () => {
        clock.tick(302);
        const messages = [{id: "message-1"}, {id: "message-2"}];
        const fakeStorage = {
          set() {
            return Promise.resolve();
          },
          get() {
            return Promise.resolve({
              [provider.id]: {
                version: STARTPAGE_VERSION,
                url: provider.url,
                messages,
                etag: "etag0987654321",
                lastUpdated: 1
              }
            });
          }
        };
        fetchStub.resolves({ok: true, status: 304, json: () => "", headers: FAKE_RESPONSE_HEADERS});
        const result = await MessageLoaderUtils.loadMessagesForProvider(provider, fakeStorage);
        assert.equal(result.messages.length, messages.length);
        messages.forEach(message => {
          assert.ok(result.messages.find(m => m.id === message.id));
        });
      });

      it("should return an empty array if json doesn't parse properly", async () => {
        fetchStub.resolves({ok: false, status: 200, json: () => "", headers: FAKE_RESPONSE_HEADERS});
        const result = await MessageLoaderUtils.loadMessagesForProvider(provider, FAKE_STORAGE);
        assert.deepEqual(result.messages, []);
      });

      it("should return an empty array if the request rejects", async () => {
        fetchStub.rejects(new Error("something went wrong"));
        const result = await MessageLoaderUtils.loadMessagesForProvider(provider, FAKE_STORAGE);
        assert.deepEqual(result.messages, []);
      });
    });
    describe("remote provider caching", () => {
      const provider = {id: "provider123", type: "remote", url: "https://foo.com", updateCycleInMs: 300};

      it("should return cached results if they aren't expired", async () => {
        clock.tick(1);
        const messages = [{id: "message-1"}, {id: "message-2"}];
        const fakeStorage = {
          set() { return Promise.resolve(); },
          get() {
            return Promise.resolve({
              [provider.id]: {
                version: STARTPAGE_VERSION,
                url: provider.url,
                messages,
                etag: "etag0987654321",
                lastUpdated: Date.now()
              }
            });
          }
        };
        const result = await MessageLoaderUtils.loadMessagesForProvider(provider, fakeStorage);
        assert.equal(result.messages.length, messages.length);
        messages.forEach(message => {
          assert.ok(result.messages.find(m => m.id === message.id));
        });
      });

      it("should return fetch results if the cache messages are expired", async () => {
        clock.tick(302);
        const testMessage = {id: "foo"};
        const respJson = {messages: [testMessage]};
        const fakeStorage = {
          set() { return Promise.resolve(); },
          get() {
            return Promise.resolve({
              [provider.id]: {
                version: STARTPAGE_VERSION,
                url: provider.url,
                messages: [{id: "message-1"}, {id: "message-2"}],
                etag: "etag0987654321",
                lastUpdated: 1
              }
            });
          }
        };
        fetchStub.resolves({ok: true, status: 200, json: () => Promise.resolve(respJson), headers: FAKE_RESPONSE_HEADERS});
        const result = await MessageLoaderUtils.loadMessagesForProvider(provider, fakeStorage);
        assert.equal(result.messages.length, 1);
        assert.equal(result.messages[0].id, testMessage.id);
      });
    });
    it("should return an empty array for a remote provider with a blank URL without attempting a request", async () => {
      const provider = {id: "provider123", type: "remote", url: ""};

      const result = await MessageLoaderUtils.loadMessagesForProvider(provider, FAKE_STORAGE);

      assert.notCalled(fetchStub);
      assert.deepEqual(result.messages, []);
    });
    it("should return .lastUpdated with the time at which the messages were fetched", async () => {
      const sourceMessage = {id: "foo"};
      const provider = {
        id: "provider123",
        type: "remote",
        url: "foo.com"
      };

      fetchStub.resolves({
        ok: true,
        status: 200,
        json: () => new Promise(resolve => {
          clock.tick(42);
          resolve({messages: [sourceMessage]});
        }),
        headers: FAKE_RESPONSE_HEADERS
      });

      const result = await MessageLoaderUtils.loadMessagesForProvider(provider, FAKE_STORAGE);

      assert.propertyVal(result, "lastUpdated", 42);
    });
  });

  describe("#shouldProviderUpdate", () => {
    it("should return true if the provider does not had a .lastUpdated property", () => {
      assert.isTrue(MessageLoaderUtils.shouldProviderUpdate({id: "foo"}));
    });
    it("should return false if the provider does not had a .updateCycleInMs property and has a .lastUpdated", () => {
      clock.tick(1);
      assert.isFalse(MessageLoaderUtils.shouldProviderUpdate({id: "foo", lastUpdated: 0}));
    });
    it("should return true if the time since .lastUpdated is greater than .updateCycleInMs", () => {
      clock.tick(301);
      assert.isTrue(MessageLoaderUtils.shouldProviderUpdate({id: "foo", lastUpdated: 0, updateCycleInMs: 300}));
    });
    it("should return false if the time since .lastUpdated is less than .updateCycleInMs", () => {
      clock.tick(299);
      assert.isFalse(MessageLoaderUtils.shouldProviderUpdate({id: "foo", lastUpdated: 0,  updateCycleInMs: 300}));
    });
  });

  describe("#installAddonFromURL", () => {
    let globals;
    let sandbox;
    let getInstallStub;
    let installAddonStub;
    beforeEach(() => {
      globals = new GlobalOverrider();
      sandbox = sinon.sandbox.create();
      getInstallStub = sandbox.stub();
      installAddonStub = sandbox.stub();
      globals.set("AddonManager", {
        getInstallForURL: getInstallStub,
        installAddonFromWebpage: installAddonStub
      });
    });
    afterEach(() => {
      sandbox.restore();
      globals.restore();
    });
    it("should call the Addons API when passed a valid URL", async () => {
      getInstallStub.resolves(null);
      installAddonStub.resolves(null);

      await MessageLoaderUtils.installAddonFromURL({}, "foo.com");

      assert.calledOnce(getInstallStub);
      assert.calledOnce(installAddonStub);
    });
    it("should not call the Addons API on invalid URLs", async () => {
      sandbox.stub(global.Services.scriptSecurityManager, "getSystemPrincipal").throws();

      await MessageLoaderUtils.installAddonFromURL({}, "https://foo.com");

      assert.notCalled(getInstallStub);
      assert.notCalled(installAddonStub);
    });
  });
});
