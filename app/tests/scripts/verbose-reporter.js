const fs = require('fs');
const path = require('path');
const util = require('util');

class VerboseReporter {
  constructor(globalConfig, options) {
    this.globalConfig = globalConfig;
    this.options = options;
    this.logsDir = path.join(__dirname, '..', 'logs');
    this.verboseDir = path.join(this.logsDir, 'verbose');
    this.passDir = path.join(this.verboseDir, 'pass');
    this.failDir = path.join(this.verboseDir, 'fail');
    
    // Clean up previous test results before each run
    this.cleanupLogs();
  }

  cleanupLogs() {
    try {
      // Create logs directory structure if it doesn't exist
      if (!fs.existsSync(this.logsDir)) {
        fs.mkdirSync(this.logsDir, { recursive: true });
      }
      if (!fs.existsSync(this.verboseDir)) {
        fs.mkdirSync(this.verboseDir, { recursive: true });
      }
      if (!fs.existsSync(this.passDir)) {
        fs.mkdirSync(this.passDir, { recursive: true });
      }
      if (!fs.existsSync(this.failDir)) {
        fs.mkdirSync(this.failDir, { recursive: true });
      }

      // Clean previous results
      const cleanDir = (dir) => {
        if (fs.existsSync(dir)) {
          const files = fs.readdirSync(dir);
          for (const file of files) {
            const filePath = path.join(dir, file);
            if (fs.statSync(filePath).isFile()) {
              fs.unlinkSync(filePath);
            }
          }
        }
      };

      cleanDir(this.passDir);
      cleanDir(this.failDir);
    } catch (error) {
      console.error('Failed to cleanup verbose logs:', error.message);
    }
  }

  formatTestDetails(test) {
    const details = {
      fullName: test.fullName || 'Unknown Test',
      title: test.title || 'Unknown Title',
      status: test.status || 'unknown',
      duration: test.duration !== undefined ? `${test.duration}ms` : 'N/A',
      numPassingAsserts: test.numPassingAsserts || 0,
      numFailingAsserts: test.numFailingAsserts || 0,
      location: test.location || 'Unknown location'
    };

    let output = `\n🔍 Test Details:\n`;
    output += `   Name: ${details.fullName}\n`;
    output += `   Title: ${details.title}\n`;
    output += `   Status: ${details.status}\n`;
    output += `   Duration: ${details.duration}\n`;
    output += `   Passing Assertions: ${details.numPassingAsserts}\n`;
    output += `   Failing Assertions: ${details.numFailingAsserts}\n`;
    
    if (details.location && details.location.line) {
      output += `   Location: Line ${details.location.line}, Column ${details.location.column || 'N/A'}\n`;
    }

    return output;
  }

  formatFailureDetails(test) {
    if (!test.failureMessages || test.failureMessages.length === 0) {
      return '';
    }

    let output = `\n🚨 FAILURE ANALYSIS:\n`;
    output += `${'='.repeat(80)}\n`;

    test.failureMessages.forEach((message, index) => {
      output += `\n📍 Failure ${index + 1}/${test.failureMessages.length}:\n`;
      output += `${'-'.repeat(40)}\n`;
      
      // Don't truncate or clean the message - show everything
      output += `${message}\n`;
      
      // Try to extract additional error details
      try {
        // Look for assertion details
        if (message.includes('expect(')) {
          const expectMatch = message.match(/expect\(([^)]+)\)/);
          if (expectMatch) {
            output += `\n🎯 Assertion Context: ${expectMatch[1]}\n`;
          }
        }

        // Look for actual vs expected values
        if (message.includes('Expected:') && message.includes('Received:')) {
          output += `\n📊 Value Comparison Details Found in Error Message Above\n`;
        }

        // Look for stack traces
        if (message.includes('at ')) {
          output += `\n📋 Stack Trace Available in Error Message Above\n`;
        }

      } catch (parseError) {
        output += `\n⚠️  Error parsing failure details: ${parseError.message}\n`;
      }
      
      output += `${'-'.repeat(40)}\n`;
    });

    return output;
  }

  formatEnvironmentInfo(testResult) {
    const { testFilePath, perfStats } = testResult;
    
    let output = `\n🌍 ENVIRONMENT & PERFORMANCE:\n`;
    output += `${'='.repeat(80)}\n`;
    output += `Test File: ${testFilePath}\n`;
    output += `Working Directory: ${process.cwd()}\n`;
    output += `Node Version: ${process.version}\n`;
    output += `Platform: ${process.platform}\n`;
    output += `Architecture: ${process.arch}\n`;
    output += `Memory Usage: ${JSON.stringify(process.memoryUsage(), null, 2)}\n`;
    
    if (perfStats) {
      output += `\n📊 Performance Stats:\n`;
      output += `   Start Time: ${new Date(perfStats.start).toISOString()}\n`;
      output += `   End Time: ${new Date(perfStats.end).toISOString()}\n`;
      output += `   Runtime: ${perfStats.runtime || 'N/A'}ms\n`;
      output += `   Slow: ${perfStats.slow || false}\n`;
    }

    // Add more runtime details
    output += `\n⏱️  Test Execution Context:\n`;
    output += `   Execution Time: ${new Date().toISOString()}\n`;
    output += `   Process PID: ${process.pid}\n`;
    output += `   Process uptime: ${process.uptime()}s\n`;

    return output;
  }

  formatTestSummary(testResults) {
    const passingTests = testResults.filter(t => t.status === 'passed');
    const failingTests = testResults.filter(t => t.status === 'failed');
    const skippedTests = testResults.filter(t => t.status === 'skipped');
    const pendingTests = testResults.filter(t => t.status === 'pending');

    let output = `\n📈 DETAILED TEST SUMMARY:\n`;
    output += `${'='.repeat(80)}\n`;
    output += `✅ Passed: ${passingTests.length}\n`;
    output += `❌ Failed: ${failingTests.length}\n`;
    output += `⏭️  Skipped: ${skippedTests.length}\n`;
    output += `⏸️  Pending: ${pendingTests.length}\n`;
    output += `📊 Total: ${testResults.length}\n`;

    // Add timing details for all tests
    const timings = testResults
      .filter(test => test.duration !== undefined)
      .map(test => test.duration);
    
    if (timings.length > 0) {
      const totalTime = timings.reduce((a, b) => a + b, 0);
      const avgTime = totalTime / timings.length;
      const maxTime = Math.max(...timings);
      const minTime = Math.min(...timings);

      output += `\n⏱️  Timing Analysis:\n`;
      output += `   Total Time: ${totalTime}ms\n`;
      output += `   Average Time: ${avgTime.toFixed(2)}ms\n`;
      output += `   Max Time: ${maxTime}ms\n`;
      output += `   Min Time: ${minTime}ms\n`;
    }

    return output;
  }

  onRunStart() {
    console.log('\n🔬 VERBOSE REPORTER STARTED');
    console.log('📁 Verbose logs will be saved to:', this.verboseDir);
  }

  onTestResult(test, testResult) {
    const { testFilePath, testResults, testExecError, failureMessage } = testResult;
    const relativePath = path.relative(process.cwd(), testFilePath);
    const filename = path.basename(testFilePath, '.ts') + '-verbose.txt';

    const passingTests = testResults.filter(t => t.status === 'passed');
    const failingTests = testResults.filter(t => t.status === 'failed');
    const skippedTests = testResults.filter(t => t.status === 'skipped');

    // A suite can fail to run entirely (compile error / load throw); then
    // testResults is empty and the error is on testExecError/failureMessage.
    const suiteError = testExecError
      ? (testExecError.stack || testExecError.message || String(testExecError))
      : (failureMessage || null);
    const hasFailing = failingTests.length > 0 || !!suiteError;
    const targetDir = hasFailing ? this.failDir : this.passDir;
    const statusIcon = hasFailing ? '❌' : '✅';
    
    // Generate comprehensive verbose output
    let output = '';
    output += `🔬 VERBOSE TEST RESULTS\n`;
    output += `${'='.repeat(80)}\n`;
    output += `📋 Test File: ${relativePath}\n`;
    output += `📅 Timestamp: ${new Date().toISOString()}\n`;
    output += `🎯 Status: ${hasFailing ? 'FAILED' : 'PASSED'}\n`;
    
    // Add environment and performance info
    output += this.formatEnvironmentInfo(testResult);
    
    // Add detailed test summary
    output += this.formatTestSummary(testResults);
    
    // Detailed passing tests (if any)
    if (passingTests.length > 0) {
      output += `\n\n✅ PASSING TESTS DETAILED BREAKDOWN:\n`;
      output += `${'='.repeat(80)}\n`;
      passingTests.forEach((test, index) => {
        output += `\n${index + 1}. ${test.fullName}`;
        output += this.formatTestDetails(test);
      });
    }
    
    // Detailed failing tests with full error analysis
    if (failingTests.length > 0) {
      output += `\n\n❌ FAILING TESTS DETAILED BREAKDOWN:\n`;
      output += `${'='.repeat(80)}\n`;
      failingTests.forEach((test, index) => {
        output += `\n${index + 1}. ${test.fullName}`;
        output += this.formatTestDetails(test);
        output += this.formatFailureDetails(test);
      });
    }
    
    // Suite-level failure (no tests executed)
    if (suiteError) {
      output += `\n\n❌ SUITE FAILED TO RUN (no tests executed):\n`;
      output += `${'='.repeat(80)}\n`;
      output += `${suiteError}\n`;
    }

    // Detailed skipped tests
    if (skippedTests.length > 0) {
      output += `\n\n⏭️  SKIPPED TESTS DETAILED BREAKDOWN:\n`;
      output += `${'='.repeat(80)}\n`;
      skippedTests.forEach((test, index) => {
        output += `\n${index + 1}. ${test.fullName}`;
        output += this.formatTestDetails(test);
        if (test.pending) {
          output += `\n   📝 Reason: Test marked as pending\n`;
        }
      });
    }

    // Add full test result object for debugging (JSON format)
    output += `\n\n🔧 RAW TEST RESULT DATA (for debugging):\n`;
    output += `${'='.repeat(80)}\n`;
    try {
      output += util.inspect(testResult, { 
        depth: null, 
        colors: false, 
        maxArrayLength: null,
        maxStringLength: null,
        breakLength: 80
      });
    } catch (inspectError) {
      output += `Error serializing test result: ${inspectError.message}\n`;
      output += `Fallback JSON: ${JSON.stringify(testResult, null, 2)}\n`;
    }
    
    // Write to appropriate directory
    const filePath = path.join(targetDir, filename);
    try {
      fs.writeFileSync(filePath, output, 'utf8');
      
      // Console output (less verbose than file output)
      console.log(`\n${statusIcon} ${hasFailing ? 'FAIL' : 'PASS'} ${relativePath}`);
      console.log(`   📁 Verbose details: ${filePath}`);
      
      if (hasFailing) {
        if (suiteError) {
          console.log(`   ❌ Suite failed to run: ${suiteError.replace(/\[[0-9;]*m/g, '').split('\n')[0]}`);
        }
        if (failingTests.length > 0) {
          console.log(`   ❌ ${failingTests.length} failing test(s):`);
          failingTests.forEach(test => {
            console.log(`      • ${test.title}`);
          });
        }
        console.log(`   🔍 Full error details available in verbose log file`);
      } else {
        console.log(`   ✅ ${passingTests.length} test(s) passed`);
      }
    } catch (error) {
      console.error(`Failed to write verbose test results to ${filePath}:`, error.message);
      console.error('Error details:', error);
    }
  }

  onRunComplete(contexts, results) {
    const { numFailedTests, numPassedTests, numTotalTests, numFailedTestSuites, numTotalTestSuites, startTime } = results;
    const duration = Date.now() - startTime;
    
    // Generate comprehensive run summary
    let summaryOutput = '';
    summaryOutput += `🔬 VERBOSE TEST RUN SUMMARY\n`;
    summaryOutput += `${'='.repeat(80)}\n`;
    summaryOutput += `📅 Completed: ${new Date().toISOString()}\n`;
    summaryOutput += `⏱️  Duration: ${duration}ms\n`;
    summaryOutput += `✅ Passed: ${numPassedTests}\n`;
    summaryOutput += `❌ Failed: ${numFailedTests}\n`;
    summaryOutput += `📊 Total: ${numTotalTests}\n`;
    if (numFailedTestSuites > 0) {
      summaryOutput += `🚨 Suites failed to run: ${numFailedTestSuites}/${numTotalTestSuites}\n`;
    }
    summaryOutput += `🎯 Success Rate: ${numTotalTests > 0 ? ((numPassedTests / numTotalTests) * 100).toFixed(2) : '0.00'}%\n`;
    
    // Add environment summary
    summaryOutput += `\n🌍 Environment Summary:\n`;
    summaryOutput += `   Node.js: ${process.version}\n`;
    summaryOutput += `   Platform: ${process.platform}\n`;
    summaryOutput += `   Working Dir: ${process.cwd()}\n`;
    summaryOutput += `   Memory Usage: ${JSON.stringify(process.memoryUsage())}\n`;
    
    // Save summary to verbose directory
    const summaryPath = path.join(this.verboseDir, 'run-summary.txt');
    try {
      fs.writeFileSync(summaryPath, summaryOutput, 'utf8');
    } catch (error) {
      console.error('Failed to write run summary:', error.message);
    }
    
    // Console output
    console.log('\n' + '='.repeat(80));
    console.log(`🔬 VERBOSE TEST RUN COMPLETE (${duration}ms)`);
    console.log(`✅ Passed: ${numPassedTests}`);
    console.log(`❌ Failed: ${numFailedTests}`);
    if (numFailedTestSuites > 0) {
      console.log(`🚨 Suites failed to run: ${numFailedTestSuites}/${numTotalTestSuites}`);
    }
    console.log(`📊 Total: ${numTotalTests}`);

    if (numFailedTests > 0 || numFailedTestSuites > 0) {
      console.log(`\n🔍 Detailed failure analysis saved to: ${this.failDir}`);
    }
    
    if (numPassedTests > 0) {
      console.log(`📁 Detailed passing test logs saved to: ${this.passDir}`);
    }
    
    console.log(`📋 Complete run summary: ${summaryPath}`);
    console.log('='.repeat(80) + '\n');
  }
}

module.exports = VerboseReporter;