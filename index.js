#!/usr/bin/env node

'use strict';

var compareFunc = require('compare-func');
var dateFormat = require('dateformat');
var resolve = require('path').resolve;
var semver = require('semver');
var through = require('through2');
var _ = require('lodash');
var fs = require('fs');
var changelog = require('conventional-changelog');
var meow = require('meow');

var cli = meow({
    help: [
        'Usage',
        '  changelog phabricator_host diffusion_id [--from <tag>]',
        '',
        'Example',
        '  changelog my.phabricator.org MYPROJECT'
    ].join('\n')
});

if(cli.input.length !== 2) {
    cli.showHelp();
    process.exit(0);
}

var phabricatorHost = cli.input[0],
    diffusionId = cli.input[1],
    from = null;

if(cli.flags && cli.flags.from) {
    from = cli.flags.from;
}

var parserOpts = {
    headerPattern: /^(\w*)(?:\((.*)\))?\: (.*)$/,
    headerCorrespondence: [
        'type',
        'scope',
        'subject'
    ],
    noteKeywords: 'BREAKING CHANGE',
    issuePrefixes: ['T'],
    referenceActions: ['Ref']
};

var regex = /tag:\s*[v=]?(.+?)[,\)]/gi;

var transform = through.obj(function(chunk, enc, cb) {
    if(typeof chunk.gitTags === 'string') {
        var match = regex.exec(chunk.gitTags);
        if(match) {
            chunk.version = match[1];
        }
    }
    regex.lastIndex = 0;

    if(chunk.committerDate) {
        chunk.committerDate = dateFormat(chunk.committerDate, 'yyyy-mm-dd', true);
    }

    cb(null, chunk);
});

var writerOpts = {
    transform: function(commit) {
        if(commit.type === 'feat') {
            commit.type = 'Features';
        } else if(commit.type === 'fix') {
            commit.type = 'Bug Fixes';
        } else if(commit.type === 'perf') {
            commit.type = 'Performance Improvements';
        } else if(commit.type === 'revert') {
            commit.type = 'Reverts';
        } else {
            return;
        }

        if(typeof commit.hash === 'string') {
            commit.hash = commit.hash.substring(0, 7);
        }

        if(typeof commit.subject === 'string') {
            commit.subject = commit.subject.substring(0, 80);
        }

        _.map(commit.notes, function(note) {
            if(note.title === 'BREAKING CHANGE') {
                note.title = 'BREAKING CHANGES';
            }

            return note;
        });

        return commit;
    },
    groupBy: 'type',
    commitGroupsSort: 'title',
    commitsSort: ['scope', 'subject'],
    noteGroupsSort: 'title',
    notesSort: compareFunc,
    generateOn: function(commit) {
        return semver.valid(commit.version);
    },
    mainTemplate: fs.readFileSync(resolve(__dirname, 'templates/main.hbs'), {
        encoding: 'utf-8'
    }),
    headerPartial: fs.readFileSync(resolve(__dirname, 'templates/header.hbs'), {
        encoding: 'utf-8'
    }),
    commitPartial: fs.readFileSync(resolve(__dirname, 'templates/commit.hbs'), {
        encoding: 'utf-8'
    }),
    footerPartial: fs.readFileSync(resolve(__dirname, 'templates/footer.hbs'), {
        encoding: 'utf-8'
    })
};
var file = fs.createWriteStream(resolve('./CHANGELOG.md'));
var options = {
        allBlocks: true,
        transform: transform
    },
    context = {
        host: phabricatorHost,
        repository: true,
        commit: 'r' + diffusionId,
        issue: 'T'
    },
    gitRawCommitsOpts = {};

if(from) {
    options.from = from;
}

changelog(options, context, gitRawCommitsOpts, parserOpts, writerOpts)
    .pipe(file);
